import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { ObjectId } from 'mongodb';
import Queue from 'bull';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const fileQueue = new Queue('fileQueue', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
  },
});

class FilesController {
  static async getUser(token) {
    const key = `auth_${token}`;
    const userId = await redisClient.get(key);
    if (!userId) return null;
    const users = dbClient.db.collection('users');
    return users.findOne({ _id: new ObjectId(userId) });
  }

  static async postUpload(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const user = await FilesController.getUser(token);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const {
      name,
      type,
      parentId = '0',
      isPublic = false,
      data,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !['folder', 'file', 'image'].includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }
    if (type !== 'folder' && !data) return res.status(400).json({ error: 'Missing data' });

    let parentFile = null;
    if (parentId !== '0') {
      parentFile = await dbClient.db.collection('files').findOne({ _id: new ObjectId(parentId) });
      if (!parentFile) return res.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }

    const fileData = {
      userId: user._id,
      name,
      type,
      isPublic,
      parentId: parentId !== '0' ? new ObjectId(parentId) : '0',
      localPath: null,
    };

    if (type === 'folder') {
      const result = await dbClient.db.collection('files').insertOne(fileData);
      return res.status(201).json({
        id: result.insertedId,
        ...fileData,
      });
    }
    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    const fileId = uuidv4();
    const localPath = path.join(folderPath, fileId);

    try {
      await fs.promises.mkdir(folderPath, { recursive: true });
      await fs.promises.writeFile(localPath, Buffer.from(data, 'base64'));
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to save file' });
    }

    fileData.localPath = localPath;
    const result = await dbClient.db.collection('files').insertOne(fileData);

    if (type === 'image') {
      fileQueue.add({
        userId: user._id,
        fileId: result.insertedId,
      });
    }

    return res.status(201).json({
      id: result.insertedId,
      ...fileData,
    });
  }
}

export default FilesController;
