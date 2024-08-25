"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Github, Hammer, MapPinned } from "lucide-react";
import { Dropdown } from "flowbite-react";
import { Fira_Code } from "next/font/google";
import axios from "axios";

// const socket = io("http://localhost:9001");
const socket = io("http://ec2-18-206-124-78.compute-1.amazonaws.com:9001");

const firaCode = Fira_Code({ subsets: ["latin"] });

export default function Home() {
  const [repoURL, setURL] = useState<string>("");
  const [installCommand, setInstallCommand] = useState<string>("");
  const [buildCommand, setBuildCommand] = useState<string>("");
  const [originalLabel, setOriginalLabel] = useState<string>("Bucket Location");
  const [location, setLocation] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectId, setProjectId] = useState<string | undefined>();
  const [deployPreviewURL, setDeployPreviewURL] = useState<
    string | undefined
  >();

  const logContainerRef = useRef<HTMLElement>(null);

  const isValidURL: [boolean, string | null] = useMemo(() => {
    if (!repoURL || repoURL.trim() === "") return [false, null];
    const regex = new RegExp(
      /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^\/]+)\/([^\/]+)(?:\/)?$/
    );
    return [regex.test(repoURL), "Enter valid Github Repository URL"];
  }, [repoURL]);

  const handleClickDeploy = useCallback(async () => {
    setLoading(true);

    const { data } = await axios.post(`http://ec2-18-206-124-78.compute-1.amazonaws.com/project`, {
    // const { data } = await axios.post(`http://localhost:9000/project`, {
      gitURL: repoURL,
      installCommand: installCommand,
      buildCommand: buildCommand,
      slug: projectId,
      location: location,
    });


    if (data && data.data) {
      const { projectSlug, url } = data.data;
      setProjectId(projectSlug);
      setDeployPreviewURL(url);

      console.log(`Subscribing to logs:${projectSlug}`);
      socket.emit("subscribe", `logs:${projectSlug}`);
    }
  }, [projectId, installCommand, buildCommand, repoURL, location]);

  const handleSocketIncommingMessage = useCallback((message: string) => {
    console.log(`[Incoming Socket Message]:`, typeof message, message);
    let logEntry: any;
    try {
      logEntry = JSON.parse(message).log;
    } catch (error) {
      console.error(
        "Error parsing JSON from message, treating as plain text",
        error
      );
      logEntry = { log: `Non-JSON message received: ${message}` };
    }
    setLogs((prev) => [...prev, logEntry]);
    logContainerRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    socket.on("message", handleSocketIncommingMessage);

    return () => {
      socket.off("message", handleSocketIncommingMessage);
    };
  }, [handleSocketIncommingMessage]);

  return (
    <main className="flex justify-center items-center h-[120vh] p-5">
      <div className="w-[600px]">
        <h1 className="mb-4 text-3xl font-extrabold text-gray-900 dark:text-white md:text-5xl lg:text-6xl">
          Welcome to{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r to-emerald-600 from-sky-400">
            Deploy Sphere.
          </span>
        </h1>
        <p className="mb-3 text-gray-500 dark:text-gray-400">
          Enabling developers to faster ship web apps by effortlessly building
          and deploying frontend React, Vite and NextJS projects, directly from
          Github to AWS S3 buckets.
        </p>
        <span className="flex justify-start items-center gap-2">
          <Github className="text-5xl" />
          <Input
            disabled={loading}
            value={repoURL}
            onChange={(e) => setURL(e.target.value)}
            type="url"
            placeholder="Github URL"
          />
        </span>
        <span className="flex justify-start items-center gap-2 mt-2">
          <Download className="text-5xl" />
          <Input
            disabled={loading}
            value={installCommand}
            onChange={(e) => setInstallCommand(e.target.value)}
            type="text"
            placeholder="Install Command e.g. npm install"
          />
        </span>
        <span className="flex justify-start items-center gap-2 mt-2">
          <Hammer className="text-5xl" />
          <Input
            disabled={loading}
            value={buildCommand}
            onChange={(e) => setBuildCommand(e.target.value)}
            type="text"
            placeholder="Build Command e.g. npm run build"
          />
        </span>

        <span className="flex justify-start items-center gap-2 mt-2">
          <MapPinned className="text-5xl" />
          <Dropdown label={originalLabel} dismissOnClick={false}>
            <Dropdown.Item value={location} onClick={() => {setLocation("us-east-1"); setOriginalLabel("Bucket Location: N. Virginia")}}>US East (N. Virginia)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("us-west-1"); setOriginalLabel("Bucket Location: N. California")}}>US West (N. California)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("ap-south-1"); setOriginalLabel("Bucket Location: Mumbai")}}>Asia Pacific (Mumbai)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("ap-southeast-1"); setOriginalLabel("Bucket Location: Singapore")}}>Asia Pacific (Singapore)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("ap-southeast-2"); setOriginalLabel("Bucket Location: Sydney")}}>Asia Pacific (Sydney)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("ap-northeast-1"); setOriginalLabel("Bucket Location: Tokyo")}}>Asia Pacific (Tokyo)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("ca-central-1"); setOriginalLabel("Bucket Location: Canada")}}>Canada (Central)</Dropdown.Item>
            <Dropdown.Item value={location} onClick={() => {setLocation("eu-west-2"); setOriginalLabel("Bucket Location: London")}}>Europe (London)</Dropdown.Item>
          </Dropdown>
          
        </span>

        <Button
          onClick={handleClickDeploy}
          disabled={!isValidURL[0] || loading}
          className="w-full mt-3"
        >
          {loading ? "In Progress" : "Deploy"}
        </Button>
        {deployPreviewURL && (
          <div className="mt-2 bg-slate-900 py-4 px-2 rounded-lg">
            <p>
              Preview URL{" "}
              <a
                target="_blank"
                className="text-sky-400 bg-sky-950 px-3 py-2 rounded-lg"
                href={deployPreviewURL}
              >
                {deployPreviewURL}
              </a>
            </p>
          </div>
        )}
        {logs.length > 0 && (
          <div
            className={`${firaCode.className} text-sm text-green-500 logs-container mt-5 border-green-500 border-2 rounded-lg p-4 h-[300px] overflow-y-auto max-w-[90vw]`}
          >
            <pre className="flex flex-col gap-1">
              {logs.map((log, i) => (
                <code
                  ref={logs.length - 1 === i ? logContainerRef : undefined}
                  key={i}
                >{`> ${log}`}</code>
              ))}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
