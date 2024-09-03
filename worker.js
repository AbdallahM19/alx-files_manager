import Queue from 'bull';
import imageThumb from 'image-thumbnail';
import { ObjectId } from 'mongodb';
import fs from 'fs';
import dbClient from './utils/db';

const fileQueue = new Queue('fileQueue');
const userQueue = new Queue('userQueue');

fileQueue.process(async (job) => {
  const { fileId, userId } = job.data;
  if (!fileId) {
    throw new Error('Missing fileId');
  }
  if (!userId) {
    throw new Error('Missing userId');
  }

  const file = await dbClient.db.collection('files')
    .findOne({ _id: new ObjectId(fileId), userId: ObjectId(userId) });
  if (!file) {
    throw new Error('File not found');
  }

  const path = file.localPath;
  fs.writeFileSync(
    `${path}_500`,
    await imageThumb(path, { width: 500 }),
  );
  fs.writeFileSync(
    `${path}_250`,
    await imageThumb(path, { width: 250 }),
  );
  fs.writeFileSync(
    `${path}_100`,
    await imageThumb(path, { width: 100 }),
  );
});

userQueue.process(async (job) => {
  const { userId } = job.data;
  if (!userId) {
    throw new Error('Missing userId');
  }

  const user = await dbClient.db.collection('users')
    .findOne({ _id: new ObjectId(userId) });
  if (!user) {
    throw new Error('User not found');
  }
  console.log(`Welcome ${user.email}!`);
});

export { fileQueue, userQueue };
