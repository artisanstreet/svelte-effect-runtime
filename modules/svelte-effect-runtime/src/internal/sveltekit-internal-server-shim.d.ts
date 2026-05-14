declare module "@sveltejs/kit/internal/server" {
  export function get_request_store(): {
    state: {
      transport: Record<string, {
        decode: (data: unknown) => unknown;
        encode: (value: unknown) => false | unknown;
      }>;
    };
  };
}
