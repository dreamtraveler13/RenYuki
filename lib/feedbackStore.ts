import { getDb } from './db';

export interface GameFeedbackInput {
  userId: string;
  content: string;
}

export const createGameFeedback = async (input: GameFeedbackInput) => {
  const db = await getDb();
  const now = new Date();
  const id = crypto.randomUUID();

  await db.query(
    `
      INSERT INTO game_feedback (
        id, user_id, content, created_at
      ) VALUES ($1, $2, $3, $4)
    `,
    [id, input.userId, input.content, now.toISOString()]
  );

  return { id, createdAt: now.toISOString() };
};
