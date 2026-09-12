import PDFDocument from 'pdfkit';
import { seatLabel } from '../lib/seating';

export interface PdfVenue {
  id: string;
  name: string;
  building: string;
  rows: number;
  cols: number;
  disabledSeats: { row: number; col: number }[];
}

export interface PdfAllocation {
  venueId: string;
  row: number;
  col: number;
  seatLabel: string;
  studentId: string; // institutional
  name: string;
  moduleCode: string;
  specialNeeds: boolean;
}

export interface PdfSession {
  title: string;
  date: Date;
  startTime: string;
  durationMin: number;
}

const PALETTE = ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#FCE7F3', '#E0E7FF', '#FFEDD5', '#CCFBF1', '#F3E8FF'];

/** One page per venue: seating grid coloured by module, then the door list sorted by student ID. */
export function renderSeatingPdf(session: PdfSession, venues: PdfVenue[], allocations: PdfAllocation[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const modules = [...new Set(allocations.map((a) => a.moduleCode))].sort();
    const colour = (code: string) => PALETTE[modules.indexOf(code) % PALETTE.length];
    const when = `${session.date.toISOString().slice(0, 10)} · ${session.startTime} · ${session.durationMin} min`;

    venues.forEach((v, vi) => {
      const here = allocations.filter((a) => a.venueId === v.id);
      if (vi > 0) doc.addPage();

      // ---- header ----
      doc.fontSize(16).font('Helvetica-Bold').text(session.title, { continued: false });
      doc.fontSize(10).font('Helvetica').fillColor('#444').text(`${when}   ·   Venue: ${v.name} (${v.building})   ·   ${here.length} seated`);
      doc.moveDown(0.3);
      let lx = doc.x;
      const ly = doc.y;
      for (const m of modules) {
        doc.rect(lx, ly, 10, 10).fill(colour(m)).stroke('#999');
        doc.fillColor('#000').fontSize(9).text(m, lx + 14, ly - 1, { continued: false });
        lx += 14 + doc.widthOfString(m) + 16;
      }
      doc.fillColor('#000');
      doc.moveDown(1);

      // ---- grid ----
      const pageW = doc.page.width - 72;
      const top = doc.y + 6;
      const availH = doc.page.height - top - 36;
      const cell = Math.min(Math.floor(pageW / v.cols), Math.floor(availH / (v.rows + 1)), 58);
      const gridW = cell * v.cols;
      const x0 = 36 + (pageW - gridW) / 2;
      const disabled = new Set(v.disabledSeats.map((d) => `${d.row}:${d.col}`));
      const byPos = new Map(here.map((a) => [`${a.row}:${a.col}`, a]));

      doc.fontSize(8).fillColor('#666').text('FRONT (invigilator desk)', x0, top - 12, { width: gridW, align: 'center' });
      for (let r = 1; r <= v.rows; r++) {
        for (let c = 1; c <= v.cols; c++) {
          const x = x0 + (c - 1) * cell;
          const y = top + (r - 1) * cell;
          const a = byPos.get(`${r}:${c}`);
          if (disabled.has(`${r}:${c}`)) {
            doc.rect(x, y, cell - 2, cell - 2).fill('#E5E7EB');
            doc.fillColor('#9CA3AF').fontSize(7).text('✕', x, y + cell / 2 - 5, { width: cell - 2, align: 'center' });
          } else if (a) {
            doc.rect(x, y, cell - 2, cell - 2).fillAndStroke(colour(a.moduleCode), '#9CA3AF');
            doc.fillColor('#111').fontSize(7).font('Helvetica-Bold').text(a.seatLabel, x + 2, y + 2, { width: cell - 6 });
            doc.font('Helvetica').fontSize(6.5).text(a.studentId, x + 2, y + cell / 2 - 4, { width: cell - 6 });
            if (a.specialNeeds) doc.fontSize(6).fillColor('#B45309').text('SN', x + cell - 16, y + 2);
          } else {
            doc.rect(x, y, cell - 2, cell - 2).stroke('#D1D5DB');
            doc.fillColor('#9CA3AF').fontSize(6.5).text(seatLabel(r, c), x + 2, y + 2, { width: cell - 6 });
          }
          doc.fillColor('#000');
        }
      }

      // ---- door list ----
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 36 });
      doc.fontSize(14).font('Helvetica-Bold').text(`Door list — ${v.name}`);
      doc.fontSize(9).font('Helvetica').fillColor('#444').text(`${session.title} · ${when} · ${here.length} candidates`);
      doc.fillColor('#000').moveDown(0.6);
      const cols = [{ h: 'Student ID', w: 90 }, { h: 'Name', w: 200 }, { h: 'Module', w: 80 }, { h: 'Seat', w: 50 }, { h: 'Signature', w: 100 }];
      const drawHeader = () => {
        let x = 36;
        const y = doc.y;
        doc.font('Helvetica-Bold').fontSize(9);
        for (const c of cols) {
          doc.text(c.h, x, y, { width: c.w });
          x += c.w;
        }
        doc.moveTo(36, y + 12).lineTo(36 + cols.reduce((s, c) => s + c.w, 0), y + 12).stroke('#999');
        doc.y = y + 16;
        doc.font('Helvetica').fontSize(9);
      };
      drawHeader();
      for (const a of [...here].sort((p, q) => p.studentId.localeCompare(q.studentId))) {
        if (doc.y > doc.page.height - 60) {
          doc.addPage({ size: 'A4', layout: 'portrait', margin: 36 });
          drawHeader();
        }
        let x = 36;
        const y = doc.y;
        const vals = [a.studentId, a.name + (a.specialNeeds ? ' (SN)' : ''), a.moduleCode, a.seatLabel, ''];
        vals.forEach((val, i) => {
          doc.text(val, x, y, { width: cols[i].w - 4 });
          x += cols[i].w;
        });
        doc.moveTo(36, y + 13).lineTo(36 + cols.reduce((s, c) => s + c.w, 0), y + 13).stroke('#EEE');
        doc.y = y + 16;
      }
    });

    doc.end();
  });
}
