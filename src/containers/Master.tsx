import { useEffect } from "react";
import styled from "styled-components";

import { startMaster } from "../scripts/masterLogic";

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export function Master() {
  useEffect(() => {
    startMaster();
  }, []);

  return (
    <Container>
      <h2>Master</h2>
    </Container>
  );
}
