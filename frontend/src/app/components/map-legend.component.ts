import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";

@Component({
  selector: "app-map-legend",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="legend">
      <h4>Map Legend</h4>
      <div class="legend-grid">
        <div class="legend-item"><span class="token blue">POL</span><label>Police patrols</label></div>
        <div class="legend-item"><span class="token red">CHK</span><label>Checkpoints</label></div>
        <div class="legend-item"><span class="token green">MED</span><label>Medical units</label></div>
        <div class="legend-item"><span class="token orange">INC</span><label>Incident location</label></div>
        <div class="legend-item"><span class="token slate">VEH</span><label>Suspect vehicle</label></div>
        <div class="legend-item"><span class="token indigo">DSP</span><label>Dispatch point</label></div>
        <div class="legend-item"><span class="token rose">RDB</span><label>Roadblock</label></div>
        <div class="legend-item"><span class="token lime">SAFE</span><label>Safe zone</label></div>
        <div class="legend-item"><span class="token dark">RISK</span><label>Danger zone</label></div>
      </div>
    </div>
  `,
  styles: [
    `
      .legend {
        border: 1px solid #e5e7eb;
        border-radius: 10px;
        padding: 0.7rem 0.8rem;
        background: #f8fafc;
      }

      h4 {
        margin: 0 0 0.45rem;
        font-size: 0.95rem;
      }

      .legend-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 0.45rem 0.8rem;
      }

      .legend-item {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        font-size: 0.82rem;
        color: #334155;
        min-width: 0;
      }

      .legend-item label {
        overflow-wrap: anywhere;
      }

      .token {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 2.25rem;
        padding: 0.1rem 0.35rem;
        border-radius: 999px;
        font-size: 0.66rem;
        font-weight: 700;
        color: #fff;
      }

      .token.blue {
        background: #2563eb;
      }

      .token.red {
        background: #dc2626;
      }

      .token.green {
        background: #16a34a;
      }

      .token.orange {
        background: #ea580c;
      }

      .token.slate {
        background: #475569;
      }

      .token.indigo {
        background: #4f46e5;
      }

      .token.rose {
        background: #e11d48;
      }

      .token.lime {
        background: #65a30d;
      }

      .token.dark {
        background: #334155;
      }

      @media (min-width: 900px) {
        .legend-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }
    `
  ]
})
export class MapLegendComponent {}
