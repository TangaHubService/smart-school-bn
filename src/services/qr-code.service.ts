import QRCode from 'qrcode';

export interface QrCodeOptions {
  width?: number;
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

const DEFAULT_OPTIONS: QrCodeOptions = {
  width: 300,
  margin: 2,
  color: {
    dark: '#000000',
    light: '#ffffff',
  },
  errorCorrectionLevel: 'H',
};

export class QrCodeService {
  async generateQrCodeDataUrl(content: string, options: QrCodeOptions = {}): Promise<string> {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    return QRCode.toDataURL(content, {
      width: mergedOptions.width,
      margin: mergedOptions.margin,
      color: mergedOptions.color,
      errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
    });
  }

  async generateQrCodeBuffer(content: string, options: QrCodeOptions = {}): Promise<Buffer> {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    return QRCode.toBuffer(content, {
      width: mergedOptions.width,
      margin: mergedOptions.margin,
      color: mergedOptions.color,
      errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
    });
  }

  async generateQrCodeSvg(content: string, options: QrCodeOptions = {}): Promise<string> {
    const mergedOptions = { ...DEFAULT_OPTIONS, ...options };
    return QRCode.toString(content, {
      type: 'svg',
      width: mergedOptions.width,
      margin: mergedOptions.margin,
      color: mergedOptions.color,
      errorCorrectionLevel: mergedOptions.errorCorrectionLevel,
    });
  }
}

export const qrCodeService = new QrCodeService();