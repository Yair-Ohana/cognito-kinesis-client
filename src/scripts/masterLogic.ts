// @ts-nocheck
import "cross-fetch/polyfill";
import AWS from "aws-sdk";
import {
  AuthenticationDetails,
  CognitoUserPool,
  CognitoUser,
} from "amazon-cognito-identity-js";

import { secrets } from "../secrets";

const master = {
  signalingClient: null,
  peerConnectionByClientId: {},
  dataChannelByClientId: {},
  localStream: null,
  remoteStreams: [],
  peerConnectionStatsInterval: null,
};

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

async function postMasterLogin(
  localView,
  remoteView,
  onStatsReport,
  onRemoteDataMessage
) {
  master.localView = localView;
  master.remoteView = remoteView;

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
  console.log("[MASTER] Channel ARN: ", channelARN);

  // Get signaling channel endpoints
  const getSignalingChannelEndpointResponse = await kinesisVideoClient
    .getSignalingChannelEndpoint({
      ChannelARN: channelARN,
      SingleMasterChannelEndpointConfiguration: {
        Protocols: ["WSS", "HTTPS"],
        Role: KVSWebRTC.Role.MASTER,
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
  console.log("[MASTER] Endpoints: ", endpointsByProtocol);

  // Create Signaling Client
  master.signalingClient = new KVSWebRTC.SignalingClient({
    channelARN,
    channelEndpoint: endpointsByProtocol.WSS,
    role: KVSWebRTC.Role.MASTER,
    region: secrets.region,
    credentials: {
      accessKeyId: AWS.config.credentials.accessKeyId,
      secretAccessKey: AWS.config.credentials.secretAccessKey,
      sessionToken: AWS.config.credentials.sessionToken,
    },
  });

  // Get ICE server configuration
  const kinesisVideoSignalingChannelsClient =
    new AWS.KinesisVideoSignalingChannels({
      region: secrets.region,
      endpoint: endpointsByProtocol.HTTPS,
      correctClockSkew: true,
    });
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
  console.log("[MASTER] ICE servers: ", iceServers);

  const configuration = {
    iceServers,
    iceTransportPolicy: secrets.forceTURN ? "relay" : "all",
  };

  const constraints = {
    video: true,
    audio: true,
  };

  // Get a stream from the webcam and display it in the local view
  try {
    master.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    localView.srcObject = master.localStream;
  } catch (e) {
    console.error("[MASTER] Could not find webcam");
  }

  master.signalingClient.on("open", async () => {
    console.log("[MASTER] Connected to signaling service");
  });

  master.signalingClient.on("sdpOffer", async (offer, remoteClientId) => {
    console.log("[MASTER] Received SDP offer from client: " + remoteClientId);

    // Create a new peer connection using the offer from the given client
    const peerConnection = new RTCPeerConnection(configuration);
    master.peerConnectionByClientId[remoteClientId] = peerConnection;

    if (secrets.openDataChannel) {
      master.dataChannelByClientId[remoteClientId] =
        peerConnection.createDataChannel("kvsDataChannel");
      peerConnection.ondatachannel = (event) => {
        event.channel.onmessage = onRemoteDataMessage;
      };
    }

    // Poll for connection stats
    if (!master.peerConnectionStatsInterval) {
      master.peerConnectionStatsInterval = setInterval(
        () => peerConnection.getStats().then(onStatsReport),
        1000
      );
    }

    // Send any ICE candidates to the other peer
    peerConnection.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate) {
        console.log(
          "[MASTER] Generated ICE candidate for client: " + remoteClientId
        );

        // When trickle ICE is enabled, send the ICE candidates as they are generated.
        if (secrets.useTrickleICE) {
          console.log(
            "[MASTER] Sending ICE candidate to client: " + remoteClientId
          );
          master.signalingClient.sendIceCandidate(candidate, remoteClientId);
        }
      } else {
        console.log(
          "[MASTER] All ICE candidates have been generated for client: " +
            remoteClientId
        );

        // When trickle ICE is disabled, send the answer now that all the ICE candidates have ben generated.
        if (!secrets.useTrickleICE) {
          console.log(
            "[MASTER] Sending SDP answer to client: " + remoteClientId
          );
          master.signalingClient.sendSdpAnswer(
            peerConnection.localDescription,
            remoteClientId
          );
        }
      }
    });

    // As remote tracks are received, add them to the remote view
    peerConnection.addEventListener("track", (event) => {
      console.log(
        "[MASTER] Received remote track from client: " + remoteClientId
      );
      if (remoteView.srcObject) {
        return;
      }
      remoteView.srcObject = event.streams[0];
    });

    master.localStream
      .getTracks()
      .forEach((track) => peerConnection.addTrack(track, master.localStream));
    await peerConnection.setRemoteDescription(offer);

    // Create an SDP answer to send back to the client
    console.log("[MASTER] Creating SDP answer for client: " + remoteClientId);
    await peerConnection.setLocalDescription(
      await peerConnection.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
    );

    // When trickle ICE is enabled, send the answer now and then send ICE candidates as they are generated. Otherwise wait on the ICE candidates.
    if (secrets.useTrickleICE) {
      console.log("[MASTER] Sending SDP answer to client: " + remoteClientId);
      master.signalingClient.sendSdpAnswer(
        peerConnection.localDescription,
        remoteClientId
      );
    }
    console.log(
      "[MASTER] Generating ICE candidates for client: " + remoteClientId
    );
  });

  master.signalingClient.on(
    "iceCandidate",
    async (candidate, remoteClientId) => {
      console.log(
        "[MASTER] Received ICE candidate from client: " + remoteClientId
      );

      // Add the ICE candidate received from the client to the peer connection
      const peerConnection = master.peerConnectionByClientId[remoteClientId];
      peerConnection.addIceCandidate(candidate);
    }
  );

  master.signalingClient.on("close", () => {
    console.log("[MASTER] Disconnected from signaling channel");
  });

  master.signalingClient.on("error", () => {
    console.error("[MASTER] Signaling client error");
  });

  console.log("[MASTER] Starting master connection");
  master.signalingClient.open();
}

export function startMaster() {
  getCredential(() => {
    postMasterLogin();
  });
}
