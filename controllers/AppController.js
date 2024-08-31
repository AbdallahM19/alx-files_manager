const redisClient = require('../utils/redis');
const dbClient = require('../utils/db');

class AppController {
  static async getStatus(req, res) {
    res.status(200).json(
      { redis: await redisClient.isAlive(), db: await dbClient.isAlive() },
    );
  }

  static async getStats(req, res) {
    res.status(200).json(
      { users: await dbClient.nbUsers(), files: await dbClient.nbFiles() },
    );
  }
}

module.exports = AppController;
