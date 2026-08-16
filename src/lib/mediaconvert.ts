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
  width: number;
  height: number;
  maxBitrate: number;
}

const RENDITIONS: Rendition[] = [
  { name: '1080p', width: 1920, height: 1080, maxBitrate: 4_500_000 },
  { name: '720p', width: 1280, height: 720, maxBitrate: 2_800_000 },
  { name: '480p', width: 854, height: 480, maxBitrate: 1_400_000 },
  { name: '360p', width: 640, height: 360, maxBitrate: 800_000 },
  { name: '240p', width: 426, height: 240, maxBitrate: 500_000 },
  { name: '144p', width: 256, height: 144, maxBitrate: 300_000 },
];

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

function videoDescription(rendition: Rendition): VideoDescription {
  return {
    Width: rendition.width,
    Height: rendition.height,
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

function buildSettings(inputUrl: string, outputBase: string, thumbnailBase: string): JobSettings {
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
        Outputs: RENDITIONS.map((rendition) => ({
          NameModifier: rendition.name,
          ContainerSettings: { Container: 'M3U8' },
          VideoDescription: videoDescription(rendition),
          AudioDescriptions: audioDescriptions,
        })),
      },
      thumbnailOutputGroup(thumbnailBase),
    ],
  };
}

/**
 * A FILE_GROUP output that captures a handful of JPEG frames from the source.
 * The completion handler picks one of these as the poster/thumbnail image.
 */
function thumbnailOutputGroup(destination: string): OutputGroup {
  return {
    Name: 'THUMBNAILS',
    OutputGroupSettings: {
      Type: 'FILE_GROUP_SETTINGS',
      FileGroupSettings: { Destination: destination },
    },
    Outputs: [
      {
        ContainerSettings: { Container: 'RAW' },
        VideoDescription: {
          Width: 1280,
          CodecSettings: {
            Codec: 'FRAME_CAPTURE',
            FrameCaptureSettings: {
              FramerateNumerator: 1,
              FramerateDenominator: 5,
              MaxCaptures: 3,
              Quality: 100,
            },
          },
        },
      },
    ],
  };
}

export interface MediaConvertJob {
  videoId: string;
  inputUrl: string;
  outputBase: string;
  thumbnailBase: string;
}

export async function startMediaConvertJob({ videoId, inputUrl, outputBase, thumbnailBase }: MediaConvertJob): Promise<void> {
  const mc = await getMediaConvertClient();
  await mc.send(
    new CreateJobCommand({
      Role: env.mediaconvertRoleArn,
      StatusUpdateInterval: 'SECONDS_60',
      UserMetadata: { videoId, inputUrl, type: 'encoding' },
      Settings: buildSettings(inputUrl, outputBase, thumbnailBase),
    }),
  );
}

export interface ThumbnailJob {
  videoId: string;
  inputUrl: string;
  outputBase: string;
}

/**
 * Submits a standalone MediaConvert job that only captures poster frames
 * (no HLS transcoding), used to regenerate a video's thumbnail.
 */
export async function startThumbnailJob({ videoId, inputUrl, outputBase }: ThumbnailJob): Promise<void> {
  const mc = await getMediaConvertClient();
  await mc.send(
    new CreateJobCommand({
      Role: env.mediaconvertRoleArn,
      StatusUpdateInterval: 'SECONDS_60',
      UserMetadata: { videoId, type: 'thumbnail' },
      Settings: {
        TimecodeConfig: { Source: 'ZEROBASED' },
        Inputs: [
          {
            FileInput: inputUrl,
            TimecodeSource: 'ZEROBASED',
          },
        ],
        OutputGroups: [thumbnailOutputGroup(outputBase)],
      },
    }),
  );
}
