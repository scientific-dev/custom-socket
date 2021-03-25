import type { WebSocketFrame, WebSocketMessage } from "https://deno.land/std@0.91.0/ws/mod.ts";
import type { BufReader, BufWriter } from "https://deno.land/std@0.91.0/io/bufio.ts";
import { Deferred, deferred } from "https://deno.land/std@0.91.0/async/deferred.ts";
import { OpCode, readFrame, writeFrame } from "https://deno.land/std@0.91.0/ws/mod.ts";
import { createConnection, Connection } from "./mod.ts";

/**
 * The queue object of the WS!
 */
export interface Queue{
    frame: WebSocketFrame;
    d: Deferred<void>;
}

/**
 * Same duplicate class which is used in std/ws/mod.ts WebsocketImpl
 * This class is made for easy handelling things.
 */
export default class WS extends EventTarget{

    protected reader!: BufReader;
    protected writer!: BufWriter;
    protected mask!: Uint8Array;
    protected conn!: Deno.Conn;
    protected queue: Queue[] = [];
    private _isClosed = false;
    readyState: 0 | 1 | 2 | 3 = 0;

    /**
     * Same duplicate class which is used in std/ws/mod.ts WebsocketImpl
     * This class is made for easy handelling things.
     * @param socket The url to connect or the connection options!
     * @param headers If provided url in socket, then provide this as custom headers. Optional.
     */
    constructor(socket: Connection | string, headers: Record<string, string> = {}) {
        super();
        this.init(socket, headers);
    }

    private async init(socket: Connection | string, headers: Record<string, string>) {
        const {
            bufReader,
            bufWriter,
            mask,
            conn
        } = typeof socket == 'string' ? await createConnection(socket, headers) : socket;

        this.readyState = 1;
        this.dispatchEvent(new Event('open'));
        this.reader = bufReader;
        this.writer = bufWriter;
        this.mask = mask;
        this.conn = conn;

        const decoder = new TextDecoder();
        let frames: WebSocketFrame[] = [];
        let payloadsLength = 0;
        
        while(!this._isClosed){
            let frame: WebSocketFrame;

            try{
                frame = await readFrame(this.reader);
            }catch(e){
                this.ensureClosed();
                break;
            }

            switch(frame.opcode){

                case OpCode.TextFrame:
                case OpCode.BinaryFrame:
                case OpCode.Continue:
                    frames.push(frame);
                    payloadsLength += frame.payload.length;

                    if(frame.isLastFrame){
                        const concat = new Uint8Array(payloadsLength);
                        let offs = 0;

                        for(let i = 0; i < frames.length; i++){
                            concat.set(frames[i].payload, offs);
                            offs += frames[i].payload.length;
                        }

                        if(frames[0].opcode == OpCode.TextFrame){
                            this.dispatchEvent(new MessageEvent('message', {
                                data: decoder.decode(concat)
                            }))
                        } else {
                            this.dispatchEvent(new MessageEvent('message', {
                                data: concat
                            }))
                        }

                        frames = [];
                        payloadsLength = 0;
                    }

                    break;

                case OpCode.Close: {
                    this.readyState = 2;
                    const code = (frame.payload[0] << 8) | frame.payload[1];
                    const reason = decoder.decode(frame.payload.subarray(2, frame.payload.length));
                    await this.close(code, reason);
                    this.dispatchEvent(new ErrorEvent('error', {
                        error: { code, reason }
                    }));
                    return;
                }

                case OpCode.Ping:
                    await this.enqueue({
                        opcode: OpCode.Pong,
                        payload: frame.payload,
                        isLastFrame: true,
                    })

                    this.dispatchEvent(new MessageEvent('ping', { data: frame.payload }))
                    break;

                case OpCode.Pong:
                    this.dispatchEvent(new MessageEvent('pong', { data: frame.payload }))
                    break;

                default:
            }
        }
    }

    /**
     * Set event listener for the close event
     */
    set onclose(listener: (ev: CloseEvent) => unknown){
        this.addEventListener('close', ((event: CloseEvent) => listener(event)) as EventListener);
    }

    /**
     * Set event listener for the message event
     */
    set onmessage(listener: (ev: MessageEvent) => unknown){
        this.addEventListener('message', ((event: MessageEvent) => listener(event)) as EventListener);
    }

    /**
     * Set event listener for the error event
     */
    set onerror(listener: (ev: ErrorEvent) => unknown){
        this.addEventListener('error', ((event: ErrorEvent) => listener(event)) as EventListener);
    }

    /**
     * Set event listener for the open event
     */
    set onopen(listener: (ev: Event) => unknown){
        this.addEventListener('open', ((event: Event) => listener(event)) as EventListener);
    }
    
    private ensureClosed(){
        try{
            this.conn.close();
        }catch(error){
            this.dispatchEvent(new ErrorEvent('error', { error }))
        }finally{
            this._isClosed = true;
            this.readyState = 3;
            this.dispatchEvent(new CloseEvent('close'));
        }
    }

    private dequeue(){
        const [entry] = this.queue;
        if(!entry || !this._isClosed) return;
        const { d, frame } = entry;

        writeFrame(frame, this.writer).then(d.resolve, d.reject).finally(() => {
            this.queue.shift();
            this.dequeue();
        })
    }

    private enqueue(frame: WebSocketFrame): Promise<void> {
        if(this._isClosed) throw new Deno.errors.ConnectionReset("Socket has already been closed!");
        const d = deferred<void>();
        this.queue.push({ d, frame });
        if(this.queue.length == 1) this.dequeue();
        return d;
    }

    /**
     * Send data to the socket
     * 
     * @param data The data to send should be either Uint8Array or string.
     * @example await ws.send("Hello world");
     */
    send(data: WebSocketMessage): Promise<void> {
        return this.enqueue( {
            isLastFrame: true,
            opcode: typeof data == 'string' ? OpCode.TextFrame : OpCode.BinaryFrame,
            payload: typeof data == 'string' ? new TextEncoder().encode(data) : data,
            mask: this.mask
        });
    }

    /**
     * Ping the socket
     * 
     * @param data The data to be sent on ping should be either Uint8Array or string.
     * @example await ws.ping("Hello world");
     */
    ping(data: WebSocketMessage): Promise<void> {
        return this.enqueue({
            isLastFrame: true,
            opcode: OpCode.Ping,
            payload: typeof data == 'string' ? new TextEncoder().encode(data) : data,
            mask: this.mask
        });
    }

    /**
     * Close the socket connection.
     * 
     * @param code The code to be used to close.the socket connection.
     * @param reason The reason for the socket to be closed.
     * @example await ws.close();
     */
    async close(code = 100, reason?: string): Promise<void> {
        if(this._isClosed) return;

        try{
            const header = [code >>> 8, code & 0x00ff];
            let payload: Uint8Array;

            if(reason){
                payload = new Uint8Array(header);
                const reasonBytes = new TextEncoder().encode(reason);
                payload = new Uint8Array(2 + reasonBytes.byteLength);
                payload.set(header);
                payload.set(reasonBytes, 2);
            } else payload = new Uint8Array(header);
            
            await this.enqueue({
                isLastFrame: true,
                opcode: OpCode.Close,
                mask: this.mask,
                payload,
            });
        }catch(e){
            throw e;
        }finally{
            this.ensureClosed();
        }
    }

    /**
     * Returns the boolean stating is the socket closed or not
     */
    get closed(){
        return this._isClosed;
    }

}
