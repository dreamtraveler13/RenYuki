
'use client';

import { SaveFile, GameScript, GeneratedAssets, UserProfile } from '../types';

const DB_NAME = 'AIGalgameDB';
const STORE_NAME = 'saveSlots';
const DB_VERSION = 1;

/**
 * Open IndexedDB connection
 */
const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
};

/**
 * Save current game state and assets
 */
export const saveGame = async (
  script: GameScript,
  assets: GeneratedAssets,
  userProfile: UserProfile,
  currentNodeId: string,
  affinity: number,
  memoryCoverBase64?: string
): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const saveData: SaveFile = {
    id: Date.now(),
    title: script.title || 'Untitled Story',
    date: new Date().toLocaleString('zh-CN'),
    heroineName: script.heroineName,
    affinity,
    currentNodeId,
    script,
    assets,
    userProfile,
    memoryCoverBase64
  };

  return new Promise((resolve, reject) => {
    const request = store.put(saveData);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Restore/Import a save file
 */
export const restoreSave = async (saveData: SaveFile): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  // Assign a new ID to ensure it's treated as a new entry and top of the list
  const newSave = { 
    ...saveData, 
    id: Date.now(), 
    date: new Date().toLocaleString('zh-CN') 
  };

  return new Promise((resolve, reject) => {
    const request = store.put(newSave);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

/**
 * Get list of all save files (metadata only ideally, but IDB loads full object usually)
 * Optimized to assume we handle the data load gracefully.
 */
export const getSaveList = async (): Promise<SaveFile[]> => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      // Sort by newest first
      const results = request.result as SaveFile[];
      resolve(results.sort((a, b) => b.id - a.id));
    };
    request.onerror = () => reject(request.error);
  });
};

/**
 * Delete a save file
 */
export const deleteSave = async (id: number): Promise<void> => {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  return new Promise((resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
