import { CommonModule, DatePipe } from "@angular/common";
import { Component, OnDestroy, inject, signal } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { MatCardModule } from "@angular/material/card";
import { MatSlideToggleModule } from "@angular/material/slide-toggle";
import { AuthService } from "../services/auth.service";
import { LiveCameraService } from "../services/live-camera.service";
import { LiveTrackingService } from "../services/live-tracking.service";
import { MediaStreamDirective } from "../directives/media-stream.directive";

@Component({
  selector: "app-live-camera-page",
  standalone: true,
  imports: [
    CommonModule,
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatSlideToggleModule,
    MediaStreamDirective
  ],
  template: `
    <div class="camera-shell">
      <mat-card class="camera-card">
        <h1>Live Camera</h1>
        <p class="muted">Start or stop web camera broadcasting for the Control Room.</p>

        <ng-container *ngIf="canSendCamera(); else notAllowed">
          <p class="state" [class.live]="camera.senderStatus() === 'LIVE'" [class.idle]="camera.senderStatus() !== 'LIVE'">
            Status: {{ camera.senderStatus() }}
          </p>

          <div class="preview-wrap">
            <video
              [appMediaStream]="camera.senderLocalStream()"
              autoplay
              playsinline
              muted
            ></video>
            <p class="muted small" *ngIf="!camera.senderLocalStream()">Preview appears when camera starts.</p>
          </div>

          <div class="controls">
            <button
              mat-raised-button
              color="primary"
              type="button"
              [disabled]="camera.senderLoading() || camera.senderStatus() === 'LIVE'"
              (click)="start()"
            >
              {{ camera.senderLoading() ? 'Starting...' : 'Start camera' }}
            </button>

            <button
              mat-stroked-button
              color="warn"
              type="button"
              [disabled]="camera.senderLoading() || camera.senderStatus() === 'IDLE'"
              (click)="stop()"
            >
              Stop camera
            </button>

            <button
              mat-stroked-button
              type="button"
              [disabled]="camera.senderStatus() !== 'LIVE'"
              (click)="camera.switchCameraFacing()"
            >
              Switch front/back
            </button>

            <button
              mat-stroked-button
              type="button"
              [disabled]="camera.senderStatus() !== 'LIVE'"
              (click)="camera.toggleMicrophone()"
            >
              {{ camera.microphoneEnabled() ? 'Mute mic' : 'Unmute mic' }}
            </button>
          </div>

          <mat-slide-toggle [checked]="emergency()" (change)="emergency.set($event.checked)">
            Mark as emergency stream
          </mat-slide-toggle>

          <p class="ok" *ngIf="camera.senderMessage()">{{ camera.senderMessage() }}</p>
          <p class="err" *ngIf="camera.senderError()">{{ camera.senderError() }}</p>

          <div class="status-grid">
            <div>
              <strong>Live tracking:</strong>
              {{ liveTracking.isSharing() ? 'GPS sharing active' : 'GPS sharing inactive' }}
            </div>
            <div>
              <strong>Last GPS:</strong>
              {{ liveTracking.lastSentAt() ? (liveTracking.lastSentAt() | date:'yyyy-MM-dd HH:mm:ss') : '-' }}
            </div>
            <div>
              <strong>Session started:</strong>
              {{ camera.senderSession()?.startedAt ? (camera.senderSession()?.startedAt | date:'yyyy-MM-dd HH:mm:ss') : '-' }}
            </div>
          </div>

          <p class="footnote">
            Web limitation: broadcast runs only while this browser tab is open and active enough to keep media capture running.
          </p>
        </ng-container>

        <ng-template #notAllowed>
          <p class="err">Live camera broadcast is not enabled for your account.</p>
          <p class="muted">Ask an administrator to enable camera sender permission and Control Room visibility.</p>
        </ng-template>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .camera-shell {
        min-height: calc(100dvh - var(--app-toolbar-height));
        padding: clamp(0.8rem, 3vw, 1.35rem);
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 12%, rgba(30, 64, 175, 0.16), transparent 44%),
          radial-gradient(circle at 85% 88%, rgba(239, 68, 68, 0.13), transparent 42%),
          linear-gradient(155deg, #f8fbff 0%, #eef5ff 55%, #f8f5ee 100%);
      }

      .camera-card {
        width: min(760px, 100%);
        display: grid;
        gap: 0.75rem;
      }

      h1 {
        margin: 0;
      }

      .state {
        margin: 0;
        font-weight: 700;
      }

      .state.live {
        color: #166534;
      }

      .state.idle {
        color: #334155;
      }

      .preview-wrap {
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        overflow: hidden;
        background: #020617;
      }

      video {
        width: 100%;
        min-height: 240px;
        max-height: 52vh;
        display: block;
        background: #020617;
      }

      .controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.55rem;
      }

      .muted {
        margin: 0;
        color: #475569;
      }

      .small {
        font-size: 0.8rem;
        padding: 0.4rem;
      }

      .status-grid {
        display: grid;
        gap: 0.45rem;
        padding: 0.5rem;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: #f8fafc;
      }

      .ok {
        color: #166534;
        margin: 0;
      }

      .err {
        color: #b91c1c;
        margin: 0;
      }

      .footnote {
        margin: 0;
        color: #334155;
        font-size: 0.85rem;
      }

      @media (max-width: 720px) {
        .controls {
          grid-template-columns: 1fr;
        }
      }
    `
  ]
})
export class LiveCameraPageComponent implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly camera = inject(LiveCameraService);
  readonly liveTracking = inject(LiveTrackingService);
  readonly emergency = signal(false);

  canSendCamera() {
    const user = this.auth.currentUser();
    return Boolean(user?.canSendLiveCamera && user?.visibleInControlRoom);
  }

  start() {
    void this.camera.startBroadcast({
      audio: true,
      emergency: this.emergency()
    });
  }

  stop() {
    void this.camera.stopBroadcast();
  }

  ngOnDestroy() {
    if (this.camera.senderStatus() !== "IDLE") {
      void this.camera.stopBroadcast("PAGE_LEFT");
    }
  }
}

