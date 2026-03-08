import { Directive, ElementRef, Input, OnChanges } from "@angular/core";

@Directive({
  selector: "video[appMediaStream]",
  standalone: true
})
export class MediaStreamDirective implements OnChanges {
  @Input("appMediaStream") stream: MediaStream | null = null;

  constructor(private readonly elementRef: ElementRef<HTMLVideoElement>) {}

  ngOnChanges() {
    const video = this.elementRef.nativeElement;
    if (video.srcObject !== this.stream) {
      video.srcObject = this.stream;
    }
  }
}

