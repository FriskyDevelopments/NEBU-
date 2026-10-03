import { QueryClient } from "@tanstack/react-query";
import { getMockResponse } from "../mocks/handlers";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  // Check if mock mode is enabled
  const useMocks = import.meta.env.VITE_USE_MOCKS === "true";

  if (useMocks) {
    // Simulate network delay for realism
    await new Promise((resolve) => setTimeout(resolve, 500));

    const mockRes = getMockResponse(method, url);
    if (mockRes) {
      console.log(`[Mock] Intercepted ${method} ${url} with status ${mockRes.status}`);
      const res = new Response(JSON.stringify(mockRes.data), {
        status: mockRes.status,
        headers: { "Content-Type": "application/json" }
      });
      await throwIfResNotOk(res);
      return res;
    } else {
      console.warn(`[Mock] Unhandled route: ${method} ${url}`);
      // Fall through to real request if mock is not defined
    }
  }

  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });
  await throwIfResNotOk(res);
  return res;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
