
export enum GameState {
  HOME,
  CREATING,
  PLAYING,
  FINISHED,
  DEV
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
  choicePromptCN?: string;
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
  voice: Record<string, string>; // nodeId -> base64 PCM (TTS)
  music: Record<string, string>; // key -> base64 audio data
}

export interface UserProfile {
  name: string;
  avatarBase64: string; 
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
  // Optional memory cover image (sweet couple photo) to show in load screen
  memoryCoverBase64?: string;
}
