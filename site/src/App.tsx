import { MotionConfig } from "motion/react";
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { Features } from "./sections/Features";
import { Quickstart } from "./sections/Quickstart";
import { Showcase } from "./sections/Showcase";
import { Footer } from "./sections/Footer";

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <Nav />
      <main id="top" className="pt-14">
        <Hero />
        <Features />
        <Quickstart />
        <Showcase />
      </main>
      <Footer />
    </MotionConfig>
  );
}
