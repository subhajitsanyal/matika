/**
 * AWS Amplify configuration for Cognito authentication.
 */
const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || '',
      signUpVerificationMethod: 'code' as const,
      loginWith: {
        email: true,
      },
    },
  },
  API: {
    REST: {
      CareLogAPI: {
        endpoint: import.meta.env.VITE_API_ENDPOINT || '',
        region: import.meta.env.VITE_AWS_REGION || 'us-east-1',
      },
    },
  },
};

export default amplifyConfig;
