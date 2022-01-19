import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";

import { Home } from "./containers/Home";
import { Viewer } from "./containers/Viewer";
import { Master } from "./containers/Master";
import { Header } from "./components/Header";

function App() {
  useEffect(() => {}, []);
  return (
    <>
      <Header />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/viewer" element={<Viewer />} />
        <Route path="/master" element={<Master />} />
      </Routes>
    </>
  );
}

export default App;
