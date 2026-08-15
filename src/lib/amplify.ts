import { Amplify } from 'aws-amplify';

const userPoolId = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;

export const isAuthConfigured = Boolean(userPoolId && userPoolClientId);

if (isAuthConfigured) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: userPoolId!,
        userPoolClientId: userPoolClientId!,
      },
    },
  });
}
