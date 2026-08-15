import {
  CreateJobCommand,
  DescribeEndpointsCommand,
  MediaConvertClient,
} from '@aws-sdk/client-mediaconvert';
import { env } from './config';

let client: MediaConvertClient | undefined;
let endpoint: string | undefined;

/** MediaConvert requires its regional API endpoint, resolved once per cold start. */
async function getMediaConvertClient(): Promise<MediaConvertClient> {
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
];

const audioDescriptions = [
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

function videoDescription(rendition: Rendition) {
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
        QualityTuning: 'SINGLE_PASS_HQ',
        FlickerAdaptiveQuantization: 'ENABLED',
      },
    },
  };
}

function buildSettings(inputUrl: string, outputBase: string) {
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
            SegmentControl: 'SEGMENTED_FILES',
            DirectoryStructure: 'SINGLE_DIRECTORY',
            ManifestDurationFormat: 'INTEGER',
            StreamInfResolution: 'INCLUDE',
            TimedMetadataId3Frame: 'PRIV',
            TimedMetadataId3Period: 10,
            DestinationType: 'S3',
          },
        },
        Outputs: RENDITIONS.map((rendition) => ({
          NameModifier: rendition.name,
          VideoDescription: videoDescription(rendition),
          AudioDescriptions: audioDescriptions,
        })),
      },
    ],
  };
}

export interface MediaConvertJob {
  videoId: string;
  inputUrl: string;
  outputBase: string;
}

export async function startMediaConvertJob({ videoId, inputUrl, outputBase }: MediaConvertJob): Promise<void> {
  const mc = await getMediaConvertClient();
  await mc.send(
    new CreateJobCommand({
      Role: env.mediaconvertRoleArn,
      StatusUpdateInterval: 'SECONDS_60',
      UserMetadata: { videoId, inputUrl },
      Settings: buildSettings(inputUrl, outputBase),
    }),
  );
}
