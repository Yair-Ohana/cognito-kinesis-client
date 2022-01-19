import { useEffect } from "react";
import styled from "styled-components";

import { startViewer } from "../scripts/viewerLogic";

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export function Viewer() {
  useEffect(() => {
    startViewer();
  }, []);

  return (
    <Container>
      <h2>Viewer</h2>
    </Container>
  );
}
