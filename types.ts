
export enum GameState {
  HOME,
  CREATING,
  PLAYING,
  FINISHED
}

export enum SpeakerType {
  HEROINE = 'Heroine',
  PROTAGONIST = 'Protagonist'
}

export interface CharacterImages {
  normal: string;
  happy: string;
  surprised: string;
  angry: string;
  shy: string; 
  sad?: string;
}

export interface Choice {
  text: string;
  nextNodeId: string; // Pointer to next node
  affinityScore: number; // Impact on relationship
}

export interface StoryNode {
  id: string;
  speaker: SpeakerType;
  textCN: string; 
  textJP?: string; 
  emotion: keyof CharacterImages | 'neutral'; 
  backgroundPrompt?: string;
  bgm?: string; // Key for Background Music
  choices?: Choice[]; 
  nextNodeId?: string; // Linear flow if no choices
  nodeType?: 'dialogue' | 'user_choice' | 'ending';
}

export interface GameScript {
  title: string;
  heroineName: string;
  startNodeId: string;
  nodes: Record<string, StoryNode>; // Dictionary of nodes
}

export interface GeneratedAssets {
  heroine: CharacterImages;
  protagonist: CharacterImages;
  backgrounds: Record<string, string>; 
  music: Record<string, string>; // key -> base64 audio data
  voice?: Record<string, string>; // nodeId -> data URL
}

export interface UserProfile {
  name: string;
  avatarBase64: string; 
}

export interface AccountUser {
  id: string;
  username: string;
  displayName: string;
  coins: number;
  bannedAt?: string;
  policyAcceptedAt?: string;
  policyVersion?: number;
  createdAt: string;
}

export type PayType = 'alipay' | 'wxpay';
export type CoinPackId = 'coin_2' | 'coin_5';
export type OrderStatus = 'created' | 'paid' | 'credited';

export interface PaymentOrder {
  outTradeNo: string;
  provider: 'zpay' | 'epay';
  payType: PayType;
  packId: CoinPackId;
  amount: string;
  coins: number;
  status: OrderStatus;
  createdAt: string;
  paidAt?: string;
  creditedAt?: string;
  tradeNo?: string;
}

export interface PlazaGameSummary {
  id: string;
  title: string;
  date: string;
  heroineName: string;
  affinity: number;
  coverBase64: string;
  plays: number;
  reportCount?: number;
}

export interface PlazaGame extends PlazaGameSummary {
  save: SaveFile;
}

export interface SaveFile {
  id: number; // Timestamp
  title: string;
  date: string;
  heroineName: string;
  affinity: number;
  currentNodeId: string;
  script: GameScript;
  assets: GeneratedAssets;
  userProfile: UserProfile;
}

export interface GameGenerationInput {
  protagonistName?: string;
  heroineName?: string;
  plotDescription: string;
  maxMode?: boolean;
  protagonistPhotoBase64?: string;
  protagonistMimeType?: string;
  heroinePhotoBase64?: string;
  heroineMimeType?: string;
}

export type GameGenerationJobState = 'queued' | 'running' | 'completed' | 'failed';

export interface GameGenerationResult {
  script: GameScript;
  assets: GeneratedAssets;
  userProfile: UserProfile;
  initialNodeId: string;
  initialAffinity: number;
}

export interface GameGenerationJobStatus {
  jobId: string;
  state: GameGenerationJobState;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  jobError?: string;
  result?: GameGenerationResult;
  resultSaveId?: number;
  debug?: unknown[];
}
