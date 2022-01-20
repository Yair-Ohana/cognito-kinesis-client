import { useEffect } from "react";
import styled from "styled-components";

import { startViewer } from "../scripts/viewerLogic";

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`;

export function Viewer() {
  useEffect(() => {
    // @ts-nocheck
    startViewer();
  }, []);

  return (
    <Container>
      <h2>Viewer</h2>
      <video
        width={500}
        height={300}
        className="videoTagViewer"
        autoPlay
        playsInline
        controls
      />
    </Container>
  );
}
