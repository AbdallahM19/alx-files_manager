import { MongoClient } from 'mongodb';

const HOST = process.env.DB_HOST || 'localhost';
const PORT = process.env.DB_PORT || 27017;
const DATABASE = process.env.DB_DATABASE || 'files_manager';

const url = `mongodb://${HOST}:${PORT}`;

class DBClient {
  constructor() {
    this.client = new MongoClient(url, { useUnifiedTopology: true, useNewUrlParser: true });
    this.isConnected = false;

    this.connectToDatabase();
  }

  async connectToDatabase() {
    try {
      await this.client.connect();
      this.db = this.client.db(DATABASE);
      this.isConnected = true;
    } catch (error) {
      this.isConnected = false;
      console.log(error);
    }
  }

  isAlive() {
    return this.isConnected && this.client.isConnected();
  }

  async nbUsers() {
    if (!this.isAlive()) return 0;
    return this.db.collection('users').countDocuments();
  }

  async nbFiles() {
    if (!this.isAlive()) return 0;
    return this.db.collection('files').countDocuments();
  }
}

export default new DBClient();
