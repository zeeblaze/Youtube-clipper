'use client'

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { YouTubeVideoItem } from "./api/collect-videos/route";

export default function Home() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<YouTubeVideoItem[]>([]);
  const [originalVideoUrl, setOriginalVideoUrl] = useState<string | null>(null);
  const [trimmedVideoUrl, setTrimmedVideoUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Cleanup URLs when component unmounts or when URLs change
  useEffect(() => {
    return () => {
      if (originalVideoUrl) {
        URL.revokeObjectURL(originalVideoUrl);
      }
      if (trimmedVideoUrl) {
        URL.revokeObjectURL(trimmedVideoUrl);
      }
    };
  }, [originalVideoUrl, trimmedVideoUrl]);

  useEffect(() => {
    loadFFmpeg();
    fetchVideos('trending');
  }, []);

  const loadFFmpeg = async () => {
    try {
      setStatus("Loading FFmpeg...");
      setError(null);

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd'
      const ffmpeg = new FFmpeg();
      ffmpegRef.current = ffmpeg;

      ffmpeg.on('log', (message) => {
        console.log(message);
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'application/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`,'application/wasm'),
      });
      
      setStatus(null); // Clear the "Loading FFmpeg..." status once loaded
    } catch (error) {
      setError("Failed to load FFmpeg");
      console.error("Error loading FFmpeg:", error);
    }
  };

  const fetchVideos = async (query: string = '') => {
    try {
      setStatus('Searching videos...');
      const response = await fetch(`/api/collect-videos?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      if (Array.isArray(data)) {
        setVideos(data);
      }
      setStatus(null);
    } catch (error) {
      console.error('Error fetching videos:', error);
      setError('Failed to fetch videos');
      setStatus(null);
    }
  };

  const processVideo = async (video: YouTubeVideoItem) => {
    if (!ffmpegRef.current || !video.id?.videoId) return;

    try {
      setStatus('Processing video...');
      setError(null);

      // Get video stream from our API
      setStatus('Downloading video...');
      const response = await fetch('/api/process-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ videoId: video.id.videoId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download video');
      }
      const videoData = await response.arrayBuffer();
      
      // Show original video immediately
      if (originalVideoUrl) URL.revokeObjectURL(originalVideoUrl);
      const originalBlob = new Blob([videoData], { type: 'video/mp4' });
      const originalUrl = URL.createObjectURL(originalBlob);
      setOriginalVideoUrl(originalUrl);
      
      // Now start processing with FFmpeg
      setStatus('Trimming video...');
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', new Uint8Array(videoData));
      
      // First, just trim the video quickly using stream copy
      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-t', '30',
        '-c', 'copy',
        'trimmed.mp4'
      ]);

      // Then, process the shorter trimmed video for portrait mode with 30fps and high quality
      await ffmpeg.exec([
        '-i', 'trimmed.mp4',
        '-vf', 'fps=30,crop=ih*9/16:ih,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '22',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        'output.mp4'
      ]);

      // Clean up old trimmed video URL and create new one
      if (trimmedVideoUrl) URL.revokeObjectURL(trimmedVideoUrl);
      const data = await ffmpeg.readFile('output.mp4');
      const trimmedBlob = new Blob([data], { type: 'video/mp4' });
      const trimmedUrl = URL.createObjectURL(trimmedBlob);
      setTrimmedVideoUrl(trimmedUrl);

      setStatus('Ready!');

    } catch (error) {
      console.error('Error processing video:', error);
      setError('Failed to process video');
      setStatus(null);
    }
  };

  const processRandomVideo = () => {
    if (videos.length > 0) {
      const randomVideo = videos[Math.floor(Math.random() * videos.length)];
      processVideo(randomVideo);
    }
  };

  return (
    <div className="grid grid-rows-[20px_1fr_20px] items-center justify-items-center min-h-screen p-8 pb-20 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-[32px] row-start-2 items-center sm:items-start">
        <div className="flex flex-col items-center gap-4 w-full max-w-xl">
          <h1 className="text-2xl font-bold">YouTube to Short Video Clipper (30s)</h1>
          
          <form 
            className="flex gap-2 w-full"
            onSubmit={(e) => {
              e.preventDefault();
              fetchVideos(searchQuery);
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for videos..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
              disabled={!!status}
            >
              Search
            </button>
          </form>

          <button
            onClick={processRandomVideo}
            disabled={!ffmpegRef.current || videos.length === 0 || !!status}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed w-full"
          >
            Process Random Video
          </button>

          {status && (
            <p className="text-gray-600">{status}</p>
          )}

          {error && (
            <p className="text-red-500">{error}</p>
          )}

          {trimmedVideoUrl && (
            <div className="flex flex-col items-center gap-4 w-full">
              <div className="flex flex-col items-center gap-2">
                <h3 className="text-lg font-semibold">Trimmed Short-Form Video</h3>
                <video 
                  key={trimmedVideoUrl}
                  src={trimmedVideoUrl}
                  controls 
                  className="w-full max-w-lg rounded-lg shadow-lg h-[640px] object-contain bg-gray-100"
                />
                <a
                  href={trimmedVideoUrl}
                  download="trimmed-video.mp4"
                  className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Download Short-Form Video
                </a>
              </div>
            </div>
          )}

          {videos.length > 0 && (
            <div className="w-full">
              <h2 className="text-xl font-semibold mb-2">
                {searchQuery ? `Results for "${searchQuery}"` : 'Trending Videos'}
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Found {videos.length} video{videos.length !== 1 ? 's' : ''}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {videos.map((video) => (
                  <div 
                    key={video.id?.videoId} 
                    className="flex flex-col gap-2 p-4 border rounded-lg hover:border-blue-500 cursor-pointer transition-all duration-200 hover:shadow-lg"
                    onClick={() => {
                      if (!status) {
                        processVideo(video);
                      }
                    }}
                  >
                    {video.snippet?.thumbnails?.medium?.url && (
                      <img 
                        src={video.snippet.thumbnails.medium.url}
                        alt={video.snippet?.title || 'Video thumbnail'}
                        className="w-full rounded-lg"
                        width={video.snippet.thumbnails.medium.width}
                        height={video.snippet.thumbnails.medium.height}
                      />
                    )}
                    <p className="text-sm font-medium line-clamp-2">{video.snippet?.title}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {originalVideoUrl && (
            <div className="flex flex-col items-center gap-4 w-full mt-8 pt-8 border-t">
              <h3 className="text-lg font-semibold">Original Video</h3>
              <div className="flex flex-col items-center gap-2">
                <video 
                  key={originalVideoUrl}
                  src={originalVideoUrl}
                  controls 
                  className="w-full max-w-lg rounded-lg shadow-lg"
                />
                <a
                  href={originalVideoUrl}
                  download="original-video.mp4"
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Download Original
                </a>
              </div>
            </div>
          )}
        </div>
      </main>
      <footer className="row-start-3 flex gap-[24px] flex-wrap items-center justify-center">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://nextjs.org/learn?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/file.svg"
            alt="File icon"
            width={16}
            height={16}
          />
          Learn
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://vercel.com/templates?framework=next.js&utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/window.svg"
            alt="Window icon"
            width={16}
            height={16}
          />
          Examples
        </a>
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://nextjs.org?utm_source=create-next-app&utm_medium=appdir-template-tw&utm_campaign=create-next-app"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Image
            aria-hidden
            src="/globe.svg"
            alt="Globe icon"
            width={16}
            height={16}
          />
          Go to nextjs.org →
        </a>
      </footer>
    </div>
  );
}
