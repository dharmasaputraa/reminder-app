import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Quickstart } from "./sections/Quickstart";

export default function App() {
  return (
    <>
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
        <Quickstart />
      </main>
    </>
  );
}
