// @ts-nocheck
import "cross-fetch/polyfill";
import AWS from "aws-sdk";
import {
  AuthenticationDetails,
  CognitoUserPool,
  CognitoUser,
} from "amazon-cognito-identity-js";

import { secrets } from "../secrets";

const viewer = {};

function getCredential(callback, err) {
  if (err) console.log(err);
  else {
    var authenticationData = {
      Username: secrets.username,
      Password: secrets.password,
    };

    var authenticationDetails = new AuthenticationDetails(authenticationData);

    var poolData = {
      UserPoolId: secrets.userPoolId, // Your user pool id here
      ClientId: secrets.clientId, // Your client id here
    };
    var userPool = new CognitoUserPool(poolData);

    var userData = {
      Username: secrets.username,
      Pool: userPool,
    };
    var cognitoUser = new CognitoUser(userData);

    //console.log(AWS.config.credentials.accessKeyId)

    //this is the call where it throws an error in the first run
    cognitoUser.authenticateUser(authenticationDetails, {
      onSuccess: function (result) {
        var accessToken = result.getAccessToken().getJwtToken();

        //POTENTIAL: Region needs to be set if not already set previously elsewhere.
        AWS.config.region = secrets.region;

        AWS.config.credentials = new AWS.CognitoIdentityCredentials({
          IdentityPoolId: secrets.identityPoolId, // your identity pool id here
          Logins: {
            // Change the key below according to the specific region your user pool is in.
            [`cognito-idp.${secrets.region}.amazonaws.com/${secrets.userPoolId}`]:
              result.getIdToken().getJwtToken(),
          },
        });

        //refreshes credentials using AWS.CognitoIdentity.getCredentialsForIdentity()
        AWS.config.credentials.refresh((error) => {
          if (error) {
            console.error(error);
          } else {
            // Instantiate aws sdk service objects now that the credentials have been updated.
            // example: var s3 = new AWS.S3();
            console.log("Successfully logged!");
            callback();
          }
        });
      },
      onFailure: function (err) {
        alert(err.message || JSON.stringify(err));
      },
    });
  }
}

async function postViewerLogin(
  localView,
  remoteView,
  onStatsReport,
  onRemoteDataMessage
) {
  viewer.localView = localView;
  viewer.remoteView = remoteView;

  // Create KVS client
  const kinesisVideoClient = new AWS.KinesisVideo({
    region: secrets.region,
    endpoint: secrets.endpoint,
    correctClockSkew: true,
  });

  // Get signaling channel ARN
  const describeSignalingChannelResponse = await kinesisVideoClient
    .describeSignalingChannel({
      ChannelName: secrets.channelName,
    })
    .promise();
  const channelARN = describeSignalingChannelResponse.ChannelInfo.ChannelARN;
  console.log("[VIEWER] Channel ARN: ", channelARN);

  // Get signaling channel endpoints
  const getSignalingChannelEndpointResponse = await kinesisVideoClient
    .getSignalingChannelEndpoint({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ["WSS", "HTTPS"],
        Role: KVSWebRTC.Role.VIEWER,
      },
    })
    .promise();
  const endpointsByProtocol =
    getSignalingChannelEndpointResponse.ResourceEndpointList.reduce(
      (endpoints, endpoint) => {
        endpoints[endpoint.Protocol] = endpoint.ResourceEndpoint;
        return endpoints;
      },
      {}
    );
  console.log("[VIEWER] Endpoints: ", endpointsByProtocol);

  const kinesisVideoSignalingChannelsClient =
    new AWS.KinesisVideoSignalingChannels({
      region: secrets.region,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });

  // Get ICE server configuration
  const getIceServerConfigResponse = await kinesisVideoSignalingChannelsClient
    .getIceServerConfig({
      ChannelARN: channelARN,
    })
    .promise();
  const iceServers = [];
  if (!secrets.natTraversalDisabled && !secrets.forceTURN) {
    iceServers.push({
      urls: `stun:stun.kinesisvideo.${secrets.region}.amazonaws.com:443`,
    });
  }
  if (!secrets.natTraversalDisabled) {
    getIceServerConfigResponse.IceServerList.forEach((iceServer) =>
      iceServers.push({
        urls: iceServer.Uris,
        username: iceServer.Username,
        credential: iceServer.Password,
      })
    );
  }
  console.log("[VIEWER] ICE servers: ", iceServers);

  // Create Signaling Client
  viewer.signalingClient = new KVSWebRTC.SignalingClient({
    channelARN,
    channelEndpoint: endpointsByProtocol.WSS,
    clientId: secrets.clientId,
    role: KVSWebRTC.Role.VIEWER,
    region: secrets.region,
    credentials: {
      accessKeyId: AWS.config.credentials.accessKeyId,
      secretAccessKey: AWS.config.credentials.secretAccessKey,
      sessionToken: AWS.config.credentials.sessionToken,
    },
  });

  const constraints = {
    video: true,
    audio: true,
  };
  const configuration = {
    iceServers,
    iceTransportPolicy: secrets.forceTURN ? "relay" : "all",
  };
  viewer.peerConnection = new RTCPeerConnection(configuration);
  if (secrets.openDataChannel) {
    viewer.dataChannel =
      viewer.peerConnection.createDataChannel("kvsDataChannel");
    viewer.peerConnection.ondatachannel = (event) => {
      event.channel.onmessage = onRemoteDataMessage;
    };
  }

  // Poll for connection stats
  viewer.peerConnectionStatsInterval = setInterval(
    () => viewer.peerConnection.getStats().then(onStatsReport),
    1000
  );

  viewer.signalingClient.on("open", async () => {
    console.log("[VIEWER] Connected to signaling service");

    // Get a stream from the webcam, add it to the peer connection, and display it in the local view
    try {
      viewer.localStream = await navigator.mediaDevices.getUserMedia(
        constraints
      );

      viewer.localStream
        .getTracks()
        .forEach((track) =>
          viewer.peerConnection.addTrack(track, viewer.localStream)
        );
      //localView.srcObject = viewer.localStream;
    } catch (e) {
      console.error("[VIEWER] Could not find webcam");
      return;
    }

    // Create an SDP offer to send to the master
    console.log("[VIEWER] Creating SDP offer");
    const test = await viewer.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });

    await viewer.peerConnection.setLocalDescription(test);

    // When trickle ICE is enabled, send the offer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
    if (secrets.useTrickleICE) {
      console.log("[VIEWER] Sending SDP offer");
      viewer.signalingClient.sendSdpOffer(
        viewer.peerConnection.localDescription
      );
    }
    console.log("[VIEWER] Generating ICE candidates");
  });

  viewer.signalingClient.on("sdpAnswer", async (answer) => {
    // Add the SDP answer to the peer connection
    console.log("[VIEWER] Received SDP answer");
    await viewer.peerConnection.setRemoteDescription(answer);
  });

  viewer.signalingClient.on("iceCandidate", (candidate) => {
    // Add the ICE candidate received from the MASTER to the peer connection
    console.log("[VIEWER] Received ICE candidate");
    viewer.peerConnection.addIceCandidate(candidate);
  });

  viewer.signalingClient.on("close", () => {
    console.log("[VIEWER] Disconnected from signaling channel");
  });

  viewer.signalingClient.on("error", (error) => {
    console.error("[VIEWER] Signaling client error: ", error);
  });

  // Send any ICE candidates to the other peer
  viewer.peerConnection.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) {
      console.log("[VIEWER] Generated ICE candidate");

      // When trickle ICE is enabled, send the ICE candidates as they are generated.
      if (secrets.useTrickleICE) {
        console.log("[VIEWER] Sending ICE candidate");
        viewer.signalingClient.sendIceCandidate(candidate);
      }
    } else {
      console.log("[VIEWER] All ICE candidates have been generated");

      // When trickle ICE is disabled, send the offer now that all the ICE candidates have ben generated.

      if (!secrets.useTrickleICE) {
        console.log("[VIEWER] Sending SDP offer");
        viewer.signalingClient.sendSdpOffer(
          viewer.peerConnection.localDescription
        );
      }
    }
  });

  // As remote tracks are received, add them to the remote view
  viewer.peerConnection.addEventListener("track", (event) => {
    console.log({ event });
    console.log("[VIEWER] Received remote track");

    viewer.remoteStream = event.streams[0];
    remoteView.srcObject = viewer.remoteStream;
  });

  console.log("[VIEWER] Starting viewer connection");
  viewer.signalingClient.open();
}

export function startViewer() {
  getCredential(() => {
    postViewerLogin();
  });
}
