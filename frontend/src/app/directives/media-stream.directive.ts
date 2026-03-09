import { Directive, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output } from "@angular/core";

export type MediaStreamBindingState = {
  sessionId: string | null;
  target: "main" | "tile" | "sender";
  hasStream: boolean;
  srcObjectBound: boolean;
  remoteVideoTrackPresent: boolean;
  playAttempted: boolean;
  playSucceeded: boolean;
  playError: string | null;
  streamId: string | null;
  at: string;
};

@Directive({
  selector: "video[appMediaStream]",
  standalone: true
})
export class MediaStreamDirective implements OnChanges, OnDestroy {
  @Input("appMediaStream") stream: MediaStream | null = null;
  @Input() appMediaStreamSessionId: string | null = null;
  @Input() appMediaStreamTarget: "main" | "tile" | "sender" = "tile";
  @Output() appMediaStreamState = new EventEmitter<MediaStreamBindingState>();

  private changeToken = 0;

  constructor(private readonly elementRef: ElementRef<HTMLVideoElement>) {}

  ngOnChanges() {
    this.changeToken += 1;
    const token = this.changeToken;
    void this.bindVideoStream(token);
  }

  ngOnDestroy() {
    this.emitState({
      hasStream: false,
      srcObjectBound: false,
      remoteVideoTrackPresent: false,
      playAttempted: false,
      playSucceeded: false,
      playError: null,
      streamId: null
    });
  }

  private async bindVideoStream(token: number) {
    const video = this.elementRef.nativeElement;
    const stream = this.stream;
    const hasStream = Boolean(stream);
    const remoteVideoTrackPresent = Boolean(stream?.getVideoTracks().length);

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    const srcObjectBound = this.isBoundToStream(video.srcObject, stream);

    if (!stream) {
      video.pause();
      this.emitState({
        hasStream: false,
        srcObjectBound: false,
        remoteVideoTrackPresent: false,
        playAttempted: false,
        playSucceeded: false,
        playError: null,
        streamId: null
      });
      return;
    }

    try {
      await video.play();
      if (token !== this.changeToken) {
        return;
      }
      this.emitState({
        hasStream,
        srcObjectBound,
        remoteVideoTrackPresent,
        playAttempted: true,
        playSucceeded: true,
        playError: null,
        streamId: stream.id
      });
    } catch (error) {
      if (token !== this.changeToken) {
        return;
      }

      const playError =
        String((error as { name?: string; message?: string })?.message ?? "").trim() ||
        String((error as { name?: string })?.name ?? "Autoplay blocked or playback failed.");

      this.emitState({
        hasStream,
        srcObjectBound,
        remoteVideoTrackPresent,
        playAttempted: true,
        playSucceeded: false,
        playError,
        streamId: stream.id
      });
    }
  }

  private isBoundToStream(bound: unknown, stream: MediaStream | null) {
    if (!stream || !bound) {
      return false;
    }

    if (bound === stream) {
      return true;
    }

    if (bound instanceof MediaStream) {
      return bound.id === stream.id;
    }

    return false;
  }

  private emitState(
    state: Omit<MediaStreamBindingState, "sessionId" | "target" | "at">
  ) {
    this.appMediaStreamState.emit({
      ...state,
      sessionId: this.appMediaStreamSessionId,
      target: this.appMediaStreamTarget,
      at: new Date().toISOString()
    });
  }
}
