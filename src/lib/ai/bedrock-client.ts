/**
 * Shared Amazon Bedrock client configuration.
 *
 * Credentials are only passed explicitly when static keys are present in the
 * environment; otherwise we let the AWS SDK's default provider chain resolve
 * them (instance role, SSO profile, container credentials, ...). Secrets never
 * leave this module.
 */

import type { BedrockRuntimeClientConfig } from '@aws-sdk/client-bedrock-runtime';
import { env, hasStaticAwsCredentials } from '@/lib/env';

export function bedrockClientConfig(): BedrockRuntimeClientConfig {
  const config: BedrockRuntimeClientConfig = {
    region: env.awsRegion,
  };

  if (hasStaticAwsCredentials()) {
    config.credentials = {
      accessKeyId: env.awsAccessKeyId!,
      secretAccessKey: env.awsSecretAccessKey!,
      ...(env.awsSessionToken ? { sessionToken: env.awsSessionToken } : {}),
    };
  }

  return config;
}
