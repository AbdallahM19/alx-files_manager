import fs from 'fs';
import { ObjectId } from 'mongodb';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

class FilesController {
  static async postUpload(req, res) {
    const token = req.headers['x-token'];
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (!userId || !token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }
    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }
    if (!data && type !== 'folder') {
      return res.status(400).json({ error: 'Missing data' });
    }

    let parentFile = null;
    if (parentId !== 0) {
      parentFile = await dbClient.db.collection('files').findOne({ _id: ObjectId(parentId) });
      if (!parentFile) {
        return res.status(400).json({ error: 'Parent not found' });
      }
      if (parentFile.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    const fileData = {
      userId: ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? '0' : ObjectId(parentId),
      localPath: null,
    };

    if (type !== 'folder') {
      const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
      const fileId = uuidv4();
      const localPath = path.join(folderPath, fileId);
      fs.mkdirSync(folderPath, { recursive: true });
      fs.writeFileSync(localPath, Buffer.from(data, 'base64'));
      fileData.localPath = localPath;
    }

    const result = await dbClient.db.collection('files').insertOne(fileData);

    return res.status(201).json({
      id: result.insertedId,
      ...fileData,
    });
  }

  static async getShow(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const fileId = req.params.id;
    const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: ObjectId(userId) });

    if (!file) return res.status(404).json({ error: 'Not found' });

    return res.json(file);
  }

  static async getIndex(req, res) {
    const token = req.headers['x-token'];
    const userIdString = await redisClient.get(`auth_${token}`);
    if (!token || !userIdString) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = ObjectId(userIdString);
    const parentId = req.query.parentId ? ObjectId(req.query.parentId) : ObjectId('0');
    const page = parseInt(req.query.page, 10) || 0;
    const limit = 20;
    const skip = page * limit;

    const filesCount = await dbClient.db.collection('files')
      .countDocuments({ userId, parentId });

    if (filesCount === 0) {
      return res.json([]);
    }

    const files = await dbClient.db.collection('files')
      .aggregate([
        { $match: { userId, parentId } },
        { $skip: skip },
        { $limit: limit },
      ]).toArray();

    const modifyResult = files.map((file) => ({
      ...file,
      id: file._id,
      _id: undefined,
    }));

    return res.json(modifyResult);
  }
}

module.exports = FilesController;
