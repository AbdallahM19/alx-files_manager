import sha1 from 'sha1';
import dbClient from '../utils/db';
import RedisClient from '../utils/redis';

const { ObjectId } = require('mongodb');

class UsersController {
  static postNew(req, res) {
    const { email, password } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    const userCollection = dbClient.db.collection('users');
    const userExists = userCollection.findOne({ email });

    if (userExists) {
      return res.status(400).json({ error: 'Already exist' });
    }

    const hashedPassword = sha1(password);
    const result = userCollection.insertOne({
      email,
      password: hashedPassword,
    });

    return res.status(201).json({ id: result.insertedId, email });
  }

  static async getMe(req, res) {
    const token = req.headers['x-token'];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await RedisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(userId) });

    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    return res.status(200).json({ id: user._id, email: user.email });
  }
}

module.exports = UsersController;
