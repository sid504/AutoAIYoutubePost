
export enum AppStep {
  DASHBOARD = 'DASHBOARD',
  TOPIC_INPUT = 'TOPIC_INPUT',
  FETCHING_NEWS = 'FETCHING_NEWS',
  GENERATING_SCRIPT = 'GENERATING_SCRIPT',
  ANIMATING_AVATAR = 'ANIMATING_AVATAR',
  GENERATING_VISUALS = 'GENERATING_VISUALS',
  GENERATING_AUDIO = 'GENERATING_AUDIO',
  UPLOADING_YOUTUBE = 'UPLOADING_YOUTUBE',
  RESULT = 'RESULT'
}

export interface ScriptSegment {
  text: string;
  visualPrompt: string;
  layout: 'CENTER' | 'SIDEBAR' | 'FULL_IMAGE';
  highlights: string[];
}

export interface GeneratedContent {
  hostVideoUrl: string;
  segments: ScriptSegment[];
  backgroundImages: string[];
  audioBlobUrl: string;
  fullScript: string;
  thumbnailUrl?: string;
  seoTags?: string[];
  newsSources?: { web: { uri: string; title: string } }[];
  recordedVideoBlob?: Blob;
}

export interface YouTubeChannel {
  name: string;
  id: string;
  thumbnail: string;
  linkedAt: string;
  accessToken?: string;
}
