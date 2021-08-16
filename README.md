# Custom Socket

As of current deno version, deno does not supports adding custom headers to the socket beacause deno follows the js web standards. So for people who want custom headers. Here is a module for it.
This module helps you to add custom headers something like this

> This package is made for some development issues. If you find bugs report an issue or create an pull request.

```ts
import WS from "https://raw.githubusercontent.com/scientific-dev/custom-socket/main/mod.ts";

const headers = {
    Authorization: "Bearer token"
};

const ws = new WS("wss://somedomain.com", headers);

ws.onopen = (ev: Event) => console.log('Socket has been opened');
ws.onmessage = (ev: MessageEvent) => console.log(ev.data);
ws.onclose = (ev: CloseEvent) => console.log('Socket has been closed');
ws.onerror = (ev: ErrorEvent) => console.log(ev.errior);
```

This package uses the codes of https://deno.land/std@0.68.0/ws and uses the latest updated standard libraries and a better `WebSocket` implementation for it.
