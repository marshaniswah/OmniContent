import { descriptor, type ConnectorValue } from "@uipath/maestro-builder-sdk";

export interface SendEmailInputs {
  /** The hidden recipients of the email, separated by comma (,) */
  BCC?: ConnectorValue<string>;
  /** The body of the email */
  Body?: ConnectorValue<string>;
  /** The secondary recipients of the email, separated by comma (,) */
  CC?: ConnectorValue<string>;
  /** The importance of the mail */
  Importance?: ConnectorValue<string>;
  /** The email addresses to use when replying, separated by comma (,) */
  ReplyTo?: ConnectorValue<string>;
  /** The subject of the email */
  Subject?: ConnectorValue<string>;
  /** The primary recipients of the email, separated by comma (,) */
  To: ConnectorValue<string>;
  /** The attachment to be sent with the email */
  file?: ConnectorValue<string>;
  /** Send an email message. By default, the email will be saved as draft. */
  SaveAsDraft?: ConnectorValue<boolean>;
}

export interface SendEmailOutputs {
  /** The importance of the mail */
  Importance?: string;
  id?: string;
  labelIds?: Array<string>;
  threadId?: string;
}

/** Send Email — uipath.connector.uipath-google-gmail.send-email */
export const SendEmail = descriptor<SendEmailInputs, SendEmailOutputs>()({
  nodeType: "uipath.connector.uipath-google-gmail.send-email",
  version: "1.0.0",
  requiresConnection: true,
  requiresFolderKey: true,
} as const);
