import fs from 'fs';
import { ObjectId } from 'mongodb';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import mime from 'mime-types';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';
import { fileQueue } from '../worker';

class FilesController {
  static async getUserData(request) {
    const token = request.headers['x-token'];
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (userId) {
      const users = dbClient.db.collection('users');
      const idObject = new ObjectId(userId);
      const user = await users.findOne({ _id: idObject });
      return user;
    }
    return null;
  }

  static async postUpload(req, res) {
    const user = await FilesController.getUserData(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!['folder', 'file', 'image'].includes(type)) return res.status(400).json({ error: 'Missing type' });
    if (type !== 'folder' && !data) return res.status(400).json({ error: 'Missing data' });

    if (parentId) {
      const parentFile = await dbClient.db.collection('files').findOne({ _id: new ObjectId(parentId) });
      if (!parentFile) return res.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    const fileData = {
      userId: user._id,
      name,
      type,
      isPublic,
      parentId: parentId !== 0 ? new ObjectId(parentId) : 0,
    };

    if (type !== 'folder') {
      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

      const localPath = path.join(folderPath, uuidv4());
      fs.writeFileSync(localPath, Buffer.from(data, 'base64'));
      fileData.localPath = localPath;

      if (type === 'image') {
        const newresult = await dbClient.db.collection('files')
          .insertOne(fileData);
        fileQueue.add({
          userId: user._id,
          fileId: newresult.insertedId,
        });
      }
    }

    const result = await dbClient.db.collection('files').insertOne(fileData);
    return res.status(201).json({
      id: result.insertedId,
      userId: fileData.userId,
      name: fileData.name,
      type: fileData.type,
      isPublic: fileData.isPublic,
      parentId: fileData.parentId,
      ...(fileData.localPath && { localPath: fileData.localPath }),
    });
  }

  static async getShow(req, res) {
    const user = await FilesController.getUserData(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(req.params.id), userId: user._id });
    if (file) {
      return res.status(200).json(file);
    }
    return res.status(404).json({ error: 'Not found' });
  }

  static async getIndex(req, res) {
    const user = await FilesController.getUserData(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { parentId = 0, page = 0 } = req.query;
    const query = { userId: user._id };
    if (parentId !== 0) {
      query.parentId = ObjectId(parentId);
    }

    const files = await dbClient.db.collection('files')
      .aggregate([
        { $match: query },
        { $sort: { _id: -1 } },
        {
          $facet: {
            metadata: [{ $count: 'total' }, { $addFields: { page: parseInt(page, 10) } }],
            data: [{ $skip: 20 * parseInt(page, 10) }, { $limit: 20 }],
          },
        },
      ])
      .toArray();

    if (files.length > 0) {
      const formattedFiles = files[0].data.map((file) => ({
        id: file._id,
        userId: file.userId,
        name: file.name,
        type: file.type,
        isPublic: file.isPublic,
        parentId: file.parentId,
      }));
      return res.status(200).json(formattedFiles);
    }

    return res.status(404).json({ error: 'Not found' });
  }

  static async putPublish(req, res) {
    const user = await FilesController.getUserData(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fileId = req.params.id;
    const file = await dbClient.db.collection('files')
      .findOne({ _id: new ObjectId(fileId), userId: user._id });
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }
    await dbClient.db.collection('files').updateOne(
      { _id: new ObjectId(fileId) },
      { $set: { isPublic: true } },
    );

    const updatedFile = await dbClient.db.collection('files')
      .findOne({ _id: new ObjectId(fileId) });
    return res.status(200).json(updatedFile);
  }

  static async putUnpublish(req, res) {
    const user = await FilesController.getUserData(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fileId = req.params.id;
    const file = await dbClient.db.collection('files')
      .findOne({ _id: new ObjectId(fileId), userId: user._id });
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }
    await dbClient.db.collection('files').updateOne(
      { _id: new ObjectId(fileId) },
      { $set: { isPublic: false } },
    );

    const updatedFile = await dbClient.db.collection('files')
      .findOne({ _id: new ObjectId(fileId) });
    return res.status(200).json(updatedFile);
  }

  static async getFile(req, res) {
    const { id } = req.params;
    const file = await dbClient.db.collection('files')
      .findOne({ _id: new ObjectId(id) });
    if (!file) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (file.type === 'folder') {
      return res.status(400)
        .json({ error: "A folder doesn't have content" });
    }

    const user = await FilesController.getUserData(req);
    if (!file.isPublic) {
      if (!user || (user._id.toString() !== file.userId.toString())) {
        return res.status(404).json({ error: 'Not found' });
      }
    }

    const { size } = req.query;
    if (size && file.type === 'image' && ['250', '500', '100'].includes(size)) {
      file.localPath = `${file.localPath}_${size}`;
    }

    if (!fs.existsSync(file.localPath)) {
      return res.status(404).json({ error: 'Not found' });
    }

    const mimeType = mime.lookup(file.name);
    res.setHeader('Content-Type', mimeType);
    return res.status(200).sendFile(file.localPath);
  }
}

export default FilesController;
