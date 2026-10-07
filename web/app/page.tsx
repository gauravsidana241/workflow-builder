import Image from "next/image";
import FlowCanvas from "@/components/FlowCanvas";

export default function Home() {
  return (
    <div className="h-screen w-full">
      <FlowCanvas />
    </div>
  );
}
