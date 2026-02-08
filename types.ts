
export type Role = 'user' | 'model';

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface MusicTrack {
  title: string;
  artist: string;
  imageUrl?: string;
}

export interface Message {
  id: string;
  role: Role;
  text: string;
  isStreaming?: boolean;
  timestamp: number;
  groundingChunks?: GroundingChunk[];
  images?: string[]; // Array of base64 strings
  musicTrack?: MusicTrack; // For music player widget
}

export interface ChatSessionConfig {
  model: string;
  systemInstruction?: string;
  useSearch?: boolean;
}

export const AVAILABLE_MODELS = [
  { id: 'ReachAI-3-flash-preview', name: 'ReachAI 3.0 Flash', description: 'Fast, efficient, low latency' },
  { id: 'ReachAI-3-pro-preview', name: 'ReachAI 3.0 Pro', description: 'Reasoning, coding, complex tasks' },
  { id: 'ReachAI-2.5-flash-image', name: 'ReachAI 2.5 Flash Image', description: 'Multimodal image analysis' },
];
