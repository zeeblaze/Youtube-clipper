import { google } from 'googleapis';
import { NextResponse } from 'next/server';

export interface YouTubeVideoItem {
    id?: { videoId?: string };
    snippet?: {
      title?: string;
      thumbnails?: {
        medium?: { url?: string; width?: number; height?: number };
      };
    };
  }

export async function GET(request: Request) {
  const apiKey = process.env.YOUTUBE_API_KEY;

  if (!apiKey) {
    console.warn('YouTube API Key not found in /api/collect-videos.');
    return NextResponse.json(
      { message: 'YouTube API Key is not configured on the server.' },
      { status: 500 }
    );
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: apiKey });
    const searchQuery = new URL(request.url).searchParams.get('q') || 'trending';
    const params = {
      part: ['snippet'],
      q: searchQuery,
      type: ['video'],      maxResults: 50,
    };

    const response = await youtube.search.list(params);
    const allVideos = (response.data.items as YouTubeVideoItem[]) || [];
    
    // Shuffle array and take first 10 items
    const shuffled = [...allVideos].sort(() => Math.random() - 0.5);
    const videos = shuffled.slice(0, 10);

    return NextResponse.json(videos);
  } catch (error: any) {
    console.error('Error fetching YouTube videos in API route:', error);
    let errorMessage = 'Failed to fetch videos from YouTube.';
    // Try to get a more specific error message from the Google API client error
    if (error.response && error.response.data && error.response.data.error) {
        errorMessage = error.response.data.error.message || errorMessage;
    } else if (error.message) {
        errorMessage = error.message;
    }
    return NextResponse.json(
      { message: 'Error fetching videos from YouTube API.', error: errorMessage },
      { status: 500 }
    );
  }
}