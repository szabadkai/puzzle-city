type PostcardOptions = {
  inscription: string;
  date: string;
  day: number;
};

function drawCover(context: CanvasRenderingContext2D, source: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
  const sourceAspect = source.width / source.height;
  const targetAspect = width / height;
  let sx = 0;
  let sy = 0;
  let sw = source.width;
  let sh = source.height;
  if (sourceAspect > targetAspect) {
    sw = source.height * targetAspect;
    sx = (source.width - sw) / 2;
  } else {
    sh = source.width / targetAspect;
    sy = (source.height - sh) / 2;
  }
  context.drawImage(source, sx, sy, sw, sh, x, y, width, height);
}

function drawPaperGrain(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.fillStyle = 'rgba(91, 70, 45, .08)';
  for (let index = 0; index < 260; index++) {
    const x = (index * 197.13) % width;
    const y = (index * index * 41.71) % height;
    const radius = .3 + (index % 4) * .18;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('The postcard image could not be created.'));
  }, 'image/png'));
}

export function postcardDate(date = new Date()) {
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

export async function composePostcard(source: HTMLCanvasElement, options: PostcardOptions) {
  const landscape = source.width >= source.height;
  const longEdge = Math.min(2400, Math.max(source.width, source.height));
  const width = Math.round(landscape ? longEdge : longEdge * 2 / 3);
  const height = Math.round(landscape ? longEdge * 2 / 3 : longEdge);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d');
  if (!context) throw new Error('The postcard image could not be created.');

  const shortEdge = Math.min(width, height);
  const margin = Math.round(shortEdge * .035);
  const footerHeight = Math.round(height * (landscape ? .23 : .20));
  const photoX = margin;
  const photoY = margin;
  const photoWidth = width - margin * 2;
  const photoHeight = height - footerHeight - margin;

  context.fillStyle = '#efe0bb';
  context.fillRect(0, 0, width, height);
  drawPaperGrain(context, width, height);
  drawCover(context, source, photoX, photoY, photoWidth, photoHeight);

  const vignette = context.createLinearGradient(0, photoY, 0, photoY + photoHeight);
  vignette.addColorStop(0, 'rgba(20, 43, 43, 0)');
  vignette.addColorStop(1, 'rgba(20, 43, 43, .18)');
  context.fillStyle = vignette;
  context.fillRect(photoX, photoY, photoWidth, photoHeight);
  context.strokeStyle = 'rgba(82, 74, 57, .22)';
  context.lineWidth = Math.max(1, shortEdge * .002);
  context.strokeRect(photoX, photoY, photoWidth, photoHeight);

  const footerTop = photoY + photoHeight;
  const left = margin * 1.55;
  const footerCenter = footerTop + footerHeight / 2;
  context.fillStyle = '#a54e43';
  context.font = `600 ${Math.round(shortEdge * .016)}px "DM Sans", sans-serif`;
  context.letterSpacing = `${Math.max(1, shortEdge * .002)}px`;
  context.fillText('GREETINGS FROM LITTLE TIDES', left, footerTop + footerHeight * .28);

  context.fillStyle = '#34443e';
  context.font = `italic 600 ${Math.round(shortEdge * .039)}px Fraunces, Georgia, serif`;
  context.letterSpacing = '0px';
  const message = options.inscription.trim() || 'Wish you were here by the water.';
  const maxMessageWidth = width * .62;
  let displayMessage = message;
  while (context.measureText(displayMessage).width > maxMessageWidth && displayMessage.length > 8) {
    displayMessage = `${displayMessage.slice(0, -2).trim()}…`;
  }
  context.fillText(displayMessage, left, footerTop + footerHeight * .59);

  context.fillStyle = 'rgba(52, 68, 62, .58)';
  context.font = `500 ${Math.round(shortEdge * .014)}px "DM Sans", sans-serif`;
  context.fillText('潮町 · a town from the sea', left, footerTop + footerHeight * .82);

  const stampX = width - margin * 3.25;
  const stampRadius = Math.min(footerHeight * .33, shortEdge * .085);
  context.save();
  context.translate(stampX, footerCenter);
  context.rotate(-.08);
  context.strokeStyle = 'rgba(165, 78, 67, .72)';
  context.lineWidth = Math.max(1.5, shortEdge * .0025);
  context.beginPath();
  context.arc(0, 0, stampRadius, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(0, 0, stampRadius * .84, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = '#a54e43';
  context.textAlign = 'center';
  context.font = `700 ${Math.round(shortEdge * .016)}px "DM Sans", sans-serif`;
  context.fillText(`DAY ${options.day}`, 0, -stampRadius * .12);
  context.font = `600 ${Math.round(shortEdge * .012)}px "DM Sans", sans-serif`;
  context.fillText(options.date.toUpperCase(), 0, stampRadius * .28);
  for (let line = -1; line <= 1; line++) {
    const y = line * stampRadius * .22;
    context.beginPath();
    context.moveTo(-stampRadius * 2.1, y);
    context.bezierCurveTo(-stampRadius * 1.75, y - stampRadius * .14, -stampRadius * 1.45, y + stampRadius * .14, -stampRadius * 1.08, y);
    context.stroke();
  }
  context.restore();

  return canvasBlob(output);
}
