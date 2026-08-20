import { BadGatewayException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { decryptIntegrationSecret } from '../orgs/integration-crypto';

@Injectable()
export class MailgunService {
  constructor(private readonly prisma: PrismaService) {}

  async isConfigured(orgId: string): Promise<boolean> {
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { mailgunApiKeyEncrypted: true, mailgunDomain: true, mailgunFromEmail: true },
    });
    return Boolean(org?.mailgunApiKeyEncrypted && org.mailgunDomain && org.mailgunFromEmail);
  }

  async sendVerification(orgId: string, to: string, name: string | null, verificationUrl: string): Promise<void> {
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { name: true, mailgunApiKeyEncrypted: true, mailgunDomain: true, mailgunFromEmail: true, mailgunRegion: true },
    });
    if (!org?.mailgunApiKeyEncrypted || !org.mailgunDomain || !org.mailgunFromEmail) {
      throw new NotFoundException('Mailgun is not configured for this organization');
    }
    const greeting = name?.trim() ? `Hello ${name.trim()},` : 'Hello,';
    await this.send(org, {
      to,
      subject: 'Confirm your Mastermind email address',
      text: `${greeting}\n\nConfirm your email address to finish creating your Mastermind account:\n${verificationUrl}\n\nThis link expires in 24 hours. If you did not create this account, ignore this email.`,
      html: `<p>${escapeHtml(greeting)}</p><p>Confirm your email address to finish creating your Mastermind account.</p><p><a href="${escapeHtml(verificationUrl)}">Confirm email address</a></p><p>This link expires in 24 hours. If you did not create this account, ignore this email.</p>`,
    });
  }

  async sendTest(orgId: string, to: string): Promise<void> {
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { name: true, mailgunApiKeyEncrypted: true, mailgunDomain: true, mailgunFromEmail: true, mailgunRegion: true },
    });
    if (!org?.mailgunApiKeyEncrypted || !org.mailgunDomain || !org.mailgunFromEmail) throw new NotFoundException('Mailgun is not configured');
    await this.send(org, { to, subject: 'Mastermind Mailgun test', text: 'Mailgun is configured correctly. Email verification is ready.', html: '<p>Mailgun is configured correctly. Email verification is ready.</p>' });
  }

  private async send(org: { name: string; mailgunApiKeyEncrypted: string | null; mailgunDomain: string | null; mailgunFromEmail: string | null; mailgunRegion: string }, message: { to: string; subject: string; text: string; html: string }) {
    const base = org.mailgunRegion === 'eu' ? 'https://api.eu.mailgun.net' : 'https://api.mailgun.net';
    const body = new FormData();
    body.set('from', `${org.name} Mastermind <${org.mailgunFromEmail}>`);
    body.set('to', message.to);
    body.set('subject', message.subject);
    body.set('text', message.text);
    body.set('html', message.html);
    const response = await fetch(`${base}/v3/${encodeURIComponent(org.mailgunDomain!)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`api:${decryptIntegrationSecret(org.mailgunApiKeyEncrypted!)}`).toString('base64')}` },
      body,
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).replace(/[\r\n]+/g, ' ').slice(0, 300);
      throw new BadGatewayException(`Mailgun rejected the message (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
