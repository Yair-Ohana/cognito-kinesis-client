import styled from "styled-components";

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
`;

export function Home() {
  return (
    <Container>
      <h2>Home Page</h2>
    </Container>
  );
}
