export const secrets = {
  region: process.env.REACT_APP_AWS_REGION,
  username: process.env.REACT_APP_COGNITO_USERNAME,
  password: process.env.REACT_APP_COGNITO_PASSWORD,
  channelName: process.env.REACT_APP_KINESIS_CN,
  clientId: process.env.REACT_APP_COGNITO_CLIENT_NAME,
  userPoolId: process.env.REACT_APP_COGNITO_USER_POOL_ID,
  identityPoolId: process.env.REACT_APP_COGNITO_IDENTITY_POOL_ID,
  useTrickleICE: false,
  forceTURN: true,
};
