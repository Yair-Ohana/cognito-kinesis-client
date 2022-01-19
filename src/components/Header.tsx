import styled from "styled-components";
import { Link } from "react-router-dom";

const Container = styled.header`
  width: 100%;
  height: 5vh;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Nav = styled.nav``;

const Anchor = styled(Link)`
  margin: 10px;
`;

export function Header() {
  return (
    <Container>
      <Nav>
        <Anchor to="/">Home</Anchor>
        <Anchor to="/master">Master</Anchor>
        <Anchor to="/viewer">Viewer</Anchor>
      </Nav>
    </Container>
  );
}
