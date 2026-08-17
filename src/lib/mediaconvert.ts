import {
  CreateJobCommand,
  DescribeEndpointsCommand,
  MediaConvertClient,
} from '@aws-sdk/client-mediaconvert';
import type {
  AudioDescription,
  JobSettings,
  OutputGroup,
  VideoDescription,
} from '@aws-sdk/client-mediaconvert';
import { env } from './config';
import { shortSide } from './video-meta';

let client: MediaConvertClient | undefined;
let endpoint: string | undefined;

/** MediaConvert requires its regional API endpoint, resolved once per cold start. */
export async function getMediaConvertClient(): Promise<MediaConvertClient> {
  if (client) return client;
  const probe = new MediaConvertClient({});
  const { Endpoints } = await probe.send(new DescribeEndpointsCommand({}));
  endpoint = Endpoints?.[0]?.Url;
  client = new MediaConvertClient({ endpoint });
  return client;
}

interface Rendition {
  name: string;
  height: number;
  maxBitrate: number;
}

/**
 * Standard ABR ladder. `height` is the target short-side resolution (the "p"
 * tier); the matching width is derived from the source aspect ratio at build
 * time. Sorted largest first.
 */
const RENDITIONS: Rendition[] = [
  { name: '2160p', height: 2160, maxBitrate: 16_000_000 },
  { name: '1440p', height: 1440, maxBitrate: 9_000_000 },
  { name: '1080p', height: 1080, maxBitrate: 4_500_000 },
  { name: '720p', height: 720, maxBitrate: 2_800_000 },
  { name: '480p', height: 480, maxBitrate: 1_400_000 },
  { name: '360p', height: 360, maxBitrate: 800_000 },
  { name: '240p', height: 240, maxBitrate: 500_000 },
  { name: '144p', height: 144, maxBitrate: 300_000 },
];

/** Fallback used when the source resolution is unknown at job time. */
const DEFAULT_SOURCE_WIDTH = 1920;
const DEFAULT_SOURCE_HEIGHT = 1080;

/** Largest even dimension (H.264 requires even width/height). */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** Bitrate ceiling for the original-resolution rendition, scaled by pixel count. */
function originalMaxBitrate(width: number, height: number): number {
  const base = 4_500_000;
  const scaled = base * ((width * height) / (1920 * 1080));
  return Math.min(Math.round(scaled), 80_000_000);
}

/**
 * Builds the rendition list for a source, capped so we never upscale past the
 * original resolution. When the source exceeds 1080p but doesn't line up with a
 * standard tier, an explicit "Original" rendition at the source resolution is
 * prepended so the original quality is always available.
 */
function buildRenditions(sourceWidth: number, sourceHeight: number): Rendition[] {
  const sourceShort = shortSide(sourceWidth, sourceHeight);
  const standard = RENDITIONS.filter((r) => r.height <= sourceShort);

  if (standard.length === 0) {
    return [{ name: 'Original', height: sourceShort, maxBitrate: originalMaxBitrate(sourceWidth, sourceHeight) }];
  }

  const top = standard[0];
  const matchesStandard = Math.abs(top.height - sourceShort) <= 2;

  if (sourceShort > 1080 && !matchesStandard) {
    return [
      { name: 'Original', height: sourceShort, maxBitrate: originalMaxBitrate(sourceWidth, sourceHeight) },
      ...standard,
    ];
  }

  return standard;
}

const audioDescriptions: AudioDescription[] = [
  {
    AudioSourceName: 'Audio Selector 1',
    CodecSettings: {
      Codec: 'AAC',
      AacSettings: {
        Bitrate: 128000,
        SampleRate: 48000,
        CodingMode: 'CODING_MODE_2_0',
      },
    },
  },
];

/**
 * Scales the rendition to the source's aspect ratio: for landscape the tier is
 * the height, for portrait the tier is the width. Dimensions are evened out.
 */
function videoDescription(
  rendition: Rendition,
  sourceWidth: number,
  sourceHeight: number,
): VideoDescription {
  let width: number;
  let height: number;

  if (sourceWidth >= sourceHeight) {
    height = rendition.height;
    width = Math.round((sourceWidth / sourceHeight) * height);
  } else {
    width = rendition.height;
    height = Math.round((sourceHeight / sourceWidth) * width);
  }

  return {
    Width: even(width),
    Height: even(height),
    CodecSettings: {
      Codec: 'H_264',
      H264Settings: {
        RateControlMode: 'QVBR',
        QvbrSettings: { QvbrQualityLevel: 8 },
        MaxBitrate: rendition.maxBitrate,
        SceneChangeDetect: 'TRANSITION_DETECTION',
        GopSize: 2,
        GopSizeUnits: 'SECONDS',
        FramerateControl: 'INITIALIZE_FROM_SOURCE',
        ParControl: 'INITIALIZE_FROM_SOURCE',
        CodecProfile: 'HIGH',
        CodecLevel: 'AUTO',
        EntropyEncoding: 'CABAC',
        Syntax: 'DEFAULT',
        InterlaceMode: 'PROGRESSIVE',
        QualityTuningLevel: 'SINGLE_PASS_HQ',
      },
    },
  };
}

/**
 * Audio-only File output group. Produces a standalone AAC track in an MP4
 * container under `processed/{videoId}/audio/` (or any provided prefix) so it
 * can be streamed independently of the video.
 */
function audioFileOutputGroup(audioOutputBase: string): OutputGroup {
  return {
    Name: 'Audio',
    OutputGroupSettings: {
      Type: 'FILE_GROUP_SETTINGS',
      FileGroupSettings: {
        Destination: audioOutputBase,
      },
    },
    Outputs: [
      {
        NameModifier: 'audio',
        ContainerSettings: {
          Container: 'MP4',
          Mp4Settings: {
            CslgAtom: 'INCLUDE',
            FreeSpaceBox: 'EXCLUDE',
            MoovPlacement: 'PROGRESSIVE_DOWNLOAD',
          },
        },
        AudioDescriptions: audioDescriptions,
      },
    ],
  };
}

function buildSettings(
  inputUrl: string,
  outputBase: string,
  sourceWidth: number,
  sourceHeight: number,
): JobSettings {
  // The audio-only track lives alongside the HLS ladder under
  // `processed/{videoId}/audio/`, produced as a standalone MP4 (AAC) file so
  // it can be streamed independently of the video.
  const audioOutputBase = outputBase.replace(/hls\/?$/, 'audio/');

  return {
    TimecodeConfig: { Source: 'ZEROBASED' },
    Inputs: [
      {
        FileInput: inputUrl,
        TimecodeSource: 'ZEROBASED',
        AudioSelectors: {
          'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
        },
      },
    ],
    OutputGroups: [
      {
        Name: 'HLS',
        OutputGroupSettings: {
          Type: 'HLS_GROUP_SETTINGS',
          HlsGroupSettings: {
            Destination: outputBase,
            SegmentLength: 6,
            MinSegmentLength: 0,
            SegmentControl: 'SEGMENTED_FILES',
            DirectoryStructure: 'SINGLE_DIRECTORY',
            ManifestDurationFormat: 'INTEGER',
            StreamInfResolution: 'INCLUDE',
            TimedMetadataId3Frame: 'PRIV',
            TimedMetadataId3Period: 10,
          },
        },
        Outputs: buildRenditions(sourceWidth, sourceHeight).map((rendition) => ({
          NameModifier: rendition.name,
          ContainerSettings: { Container: 'M3U8' },
          VideoDescription: videoDescription(rendition, sourceWidth, sourceHeight),
          AudioDescriptions: audioDescriptions,
        })),
      },
      audioFileOutputGroup(audioOutputBase),
    ],
  };
}

export interface MediaConvertJob {
  videoId: string;
  inputUrl: string;
  outputBase: string;
  sourceWidth?: number;
  sourceHeight?: number;
}

export async function startMediaConvertJob({
  videoId,
  inputUrl,
  outputBase,
  sourceWidth,
  sourceHeight,
}: MediaConvertJob): Promise<void> {
  const mc = await getMediaConvertClient();
  const width = sourceWidth && sourceHeight ? sourceWidth : DEFAULT_SOURCE_WIDTH;
  const height = sourceWidth && sourceHeight ? sourceHeight : DEFAULT_SOURCE_HEIGHT;
  await mc.send(
    new CreateJobCommand({
      Role: env.mediaconvertRoleArn,
      StatusUpdateInterval: 'SECONDS_60',
      UserMetadata: { videoId, inputUrl, type: 'encoding' },
      Settings: buildSettings(inputUrl, outputBase, width, height),
    }),
  );
}

export interface AudioExtractionJob {
  videoId: string;
  inputUrl: string;
  outputBase: string;
}

/**
 * Submits a MediaConvert job that only extracts the audio track (no video
 * ladder) from an existing raw upload. Used to (re)generate audio for videos
 * that predate audio extraction.
 */
export async function startAudioExtractionJob({
  videoId,
  inputUrl,
  outputBase,
}: AudioExtractionJob): Promise<void> {
  const mc = await getMediaConvertClient();
  await mc.send(
    new CreateJobCommand({
      Role: env.mediaconvertRoleArn,
      StatusUpdateInterval: 'SECONDS_60',
      UserMetadata: { videoId, inputUrl, type: 'audio' },
      Settings: {
        TimecodeConfig: { Source: 'ZEROBASED' },
        Inputs: [
          {
            FileInput: inputUrl,
            TimecodeSource: 'ZEROBASED',
            AudioSelectors: {
              'Audio Selector 1': { DefaultSelection: 'DEFAULT' },
            },
          },
        ],
        OutputGroups: [audioFileOutputGroup(outputBase)],
      },
    }),
  );
}
