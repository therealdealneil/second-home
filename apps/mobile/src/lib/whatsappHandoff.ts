import {
  buildWhatsappHandoffUrl,
  type ConnectionStatus,
  type PublicHouseholdMember,
} from "@second-home/shared";
import * as Linking from "expo-linking";

/**
 * Synthetic demo phones mirroring `supabase/seed/san_antonio_mock_households.sql`.
 * Kept strictly isolated inside this handoff helper and NEVER stored on client
 * pin payloads, AppFlowState, or AsyncStorage — released only after mutual acceptance.
 */
const MOCK_MEMBER_PHONES_E164: Readonly<Record<string, string>> = {
  "10000000-0000-4000-8000-000000000001": "+12105550101",
  "10000000-0000-4000-8000-000000000002": "+12105550102",
  "10000000-0000-4000-8000-000000000003": "+12105550103",
  "10000000-0000-4000-8000-000000000004": "+12105550104",
  "10000000-0000-4000-8000-000000000005": "+12105550105",
  "10000000-0000-4000-8000-000000000006": "+12105550106",
  "10000000-0000-4000-8000-000000000007": "+12105550107",
  "10000000-0000-4000-8000-000000000008": "+12105550108",
  "10000000-0000-4000-8000-000000000009": "+12105550109",
  "10000000-0000-4000-8000-000000000010": "+12105550110",
  "10000000-0000-4000-8000-000000000011": "+12105550111",
  "10000000-0000-4000-8000-000000000012": "+12105550112",
  "10000000-0000-4000-8000-000000000013": "+12105550113",
  "10000000-0000-4000-8000-000000000014": "+12105550114",
  "10000000-0000-4000-8000-000000000015": "+12105550115",
  "10000000-0000-4000-8000-000000000016": "+12105550116",
  "10000000-0000-4000-8000-000000000017": "+12105550117",
  "10000000-0000-4000-8000-000000000018": "+12105550118",
  "10000000-0000-4000-8000-000000000019": "+12105550119",
  "10000000-0000-4000-8000-000000000020": "+12105550120",
  "10000000-0000-4000-8000-000000000021": "+12105550121",
  "10000000-0000-4000-8000-000000000022": "+12105550122",
  "10000000-0000-4000-8000-000000000023": "+12105550123",
  "10000000-0000-4000-8000-000000000024": "+12105550124",
};

/**
 * Prototype mirror of `get_whatsapp_handoff_link`: releases a `wa.me` deep link
 * ONLY when `connectionStatus === "accepted"`.
 */
export function getMockWhatsappHandoffLink(params: {
  member: PublicHouseholdMember;
  connectionStatus: ConnectionStatus | undefined;
}): string | null {
  if (params.connectionStatus !== "accepted") {
    return null;
  }
  const phoneE164 = MOCK_MEMBER_PHONES_E164[params.member.userId];
  if (!phoneE164) {
    return null;
  }
  return buildWhatsappHandoffUrl({
    phoneE164,
    recipientFirstName: params.member.firstName,
    hometownDistrict: params.member.hometownDistrict,
  });
}

export async function openWhatsappUrl(url: string): Promise<boolean> {
  if (!url.startsWith("https://wa.me/")) {
    return false;
  }
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      return false;
    }
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}
