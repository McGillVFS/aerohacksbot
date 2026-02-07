import { ROLE_MAP } from "./roleMap";

type Role = {
  id: string;
  name: string;
  position: number;
};

type GuildMember = {
  user: { id: string };
  roles: string[];
};

type RegistrationRoleFields = {
  fields_of_study: string[] | null;
  interests: string[] | null;
  level_of_study: string | null;
  school: string | null;
  school_other: string | null;
  team_mode: string | null;
  team_name: string | null;
};

type AssignRolesInput = {
  guildId: string;
  discordUserId: string;
  registration: RegistrationRoleFields;
};

type AssignRolesResult = {
  assignedRoleNames: string[];
  skippedExistingRoleNames: string[];
  skippedHierarchyRoleNames: string[];
  failedRoleNames: string[];
};

type EditOriginalInteractionResponseInput = {
  applicationId: string;
  interactionToken: string;
  content: string;
};

const DISCORD_API_BASE = "https://discord.com/api/v10";
const DISCORD_API_TIMEOUT_MS = Number(process.env.DISCORD_API_TIMEOUT_MS ?? "7000");
const MAX_ROLE_OPERATIONS = Number(process.env.MAX_ROLE_OPERATIONS ?? "24");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

const discordBotToken = DISCORD_TOKEN;
let cachedBotUserId: string | null = null;

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DISCORD_API_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function discordApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (!discordBotToken) {
    throw new Error("Missing required env var: DISCORD_TOKEN");
  }

  const response = await fetchWithTimeout(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${discordBotToken}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Discord API ${init?.method ?? "GET"} ${path} failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function getBotUserId(): Promise<string> {
  if (cachedBotUserId) {
    return cachedBotUserId;
  }

  const data = await discordApi<{ id: string }>("/users/@me");
  cachedBotUserId = data.id;
  return data.id;
}

async function listGuildRoles(guildId: string): Promise<Role[]> {
  return discordApi<Role[]>(`/guilds/${guildId}/roles`);
}

async function getGuildMember(guildId: string, userId: string): Promise<GuildMember> {
  return discordApi<GuildMember>(`/guilds/${guildId}/members/${userId}`);
}

async function createGuildRole(guildId: string, roleName: string): Promise<Role> {
  return discordApi<Role>(`/guilds/${guildId}/roles`, {
    method: "POST",
    body: JSON.stringify({
      name: roleName,
      permissions: "0",
      hoist: false,
      mentionable: false,
    }),
  });
}

async function assignRoleToMember(guildId: string, userId: string, roleId: string): Promise<void> {
  await discordApi<void>(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
  });
}

function normalizeRoleName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 100);
}

function mappedOrDefault(
  category: "interests" | "fields_of_study" | "level_of_study" | "school",
  value: string,
  fallbackPrefix: string
): string {
  const mapped = ROLE_MAP[category][value as keyof (typeof ROLE_MAP)[typeof category]];
  return mapped ?? `${fallbackPrefix}: ${value}`;
}

function buildDesiredRoleNames(registration: RegistrationRoleFields): string[] {
  const roleNames = new Set<string>();

  for (const field of registration.fields_of_study ?? []) {
    const normalized = normalizeRoleName(field);
    if (!normalized) continue;
    roleNames.add(normalizeRoleName(mappedOrDefault("fields_of_study", normalized, "Field")));
  }

  for (const interest of registration.interests ?? []) {
    const normalized = normalizeRoleName(interest);
    if (!normalized) continue;
    roleNames.add(normalizeRoleName(mappedOrDefault("interests", normalized, "Interest")));
  }

  if (registration.level_of_study) {
    const normalized = normalizeRoleName(registration.level_of_study);
    if (normalized) {
      roleNames.add(normalizeRoleName(mappedOrDefault("level_of_study", normalized, "Level")));
    }
  }

  const schoolValue =
    registration.school === "Other" ? normalizeRoleName(registration.school_other ?? "") : normalizeRoleName(registration.school ?? "");
  if (schoolValue) {
    roleNames.add(normalizeRoleName(mappedOrDefault("school", schoolValue, "School")));
  }

  if (registration.team_mode === "free_agent") {
    roleNames.add(ROLE_MAP.team_mode.free_agent);
  }

  if (registration.team_mode === "team") {
    const teamName = normalizeRoleName(registration.team_name ?? "");
    if (teamName) {
      roleNames.add(normalizeRoleName(`Team: ${teamName}`));
    }
  }

  return Array.from(roleNames);
}

function getMemberTopRolePosition(memberRoleIds: string[], guildRolesById: Map<string, Role>): number {
  let topPosition = 0;
  for (const roleId of memberRoleIds) {
    const role = guildRolesById.get(roleId);
    if (!role) continue;
    if (role.position > topPosition) {
      topPosition = role.position;
    }
  }
  return topPosition;
}

export async function assignRolesFromRegistration(input: AssignRolesInput): Promise<AssignRolesResult> {
  const desiredRoleNames = buildDesiredRoleNames(input.registration);
  if (desiredRoleNames.length === 0) {
    return {
      assignedRoleNames: [],
      skippedExistingRoleNames: [],
      skippedHierarchyRoleNames: [],
      failedRoleNames: [],
    };
  }

  const guildRoles = await listGuildRoles(input.guildId);
  const guildRolesById = new Map(guildRoles.map((role) => [role.id, role]));
  const roleByLowerName = new Map(guildRoles.map((role) => [role.name.toLowerCase(), role]));

  const botUserId = await getBotUserId();
  const [member, botMember] = await Promise.all([
    getGuildMember(input.guildId, input.discordUserId),
    getGuildMember(input.guildId, botUserId),
  ]);

  const memberRoleIds = new Set(member.roles);
  const botTopRolePosition = getMemberTopRolePosition(botMember.roles, guildRolesById);

  const skippedExistingRoleNames: string[] = [];
  const skippedHierarchyRoleNames: string[] = [];
  const failedRoleNames: string[] = [];
  const assignmentQueue: Array<{ roleName: string; roleId: string }> = [];

  const missingRoleNames: string[] = [];
  for (const desiredRoleName of desiredRoleNames) {
    const roleKey = desiredRoleName.toLowerCase();
    const role = roleByLowerName.get(roleKey);
    if (!role) {
      missingRoleNames.push(desiredRoleName);
    }
  }

  const roleCreationResults = await Promise.allSettled(
    missingRoleNames.map(async (roleName) => {
      const created = await createGuildRole(input.guildId, roleName);
      return created;
    })
  );

  roleCreationResults.forEach((result, index) => {
    const roleName = missingRoleNames[index];
    if (!roleName) return;

    if (result.status === "rejected") {
      failedRoleNames.push(roleName);
      console.error("Failed to create role:", roleName, result.reason);
      return;
    }

    const createdRole = result.value;
    roleByLowerName.set(createdRole.name.toLowerCase(), createdRole);
    guildRolesById.set(createdRole.id, createdRole);
  });

  for (const desiredRoleName of desiredRoleNames) {
    const role = roleByLowerName.get(desiredRoleName.toLowerCase());
    if (!role) {
      continue;
    }

    if (memberRoleIds.has(role.id)) {
      skippedExistingRoleNames.push(role.name);
      continue;
    }

    if (role.position >= botTopRolePosition) {
      skippedHierarchyRoleNames.push(role.name);
      continue;
    }

    assignmentQueue.push({ roleName: role.name, roleId: role.id });
  }

  const boundedAssignmentQueue = assignmentQueue.slice(0, Math.max(0, MAX_ROLE_OPERATIONS));
  for (const skipped of assignmentQueue.slice(boundedAssignmentQueue.length)) {
    failedRoleNames.push(skipped.roleName);
    console.error("Skipping role assignment due to MAX_ROLE_OPERATIONS cap:", skipped.roleName);
  }

  const assignments = await Promise.allSettled(
    boundedAssignmentQueue.map(async ({ roleName, roleId }) => {
      await assignRoleToMember(input.guildId, input.discordUserId, roleId);
      return roleName;
    })
  );

  const assignedRoleNames: string[] = [];

  assignments.forEach((result, index) => {
    const roleName = boundedAssignmentQueue[index]?.roleName;
    if (!roleName) return;

    if (result.status === "fulfilled") {
      assignedRoleNames.push(result.value);
      return;
    }

    failedRoleNames.push(roleName);
    console.error("Failed to assign role:", roleName, result.reason);
  });

  return {
    assignedRoleNames,
    skippedExistingRoleNames,
    skippedHierarchyRoleNames,
    failedRoleNames,
  };
}

export async function editOriginalInteractionResponse(input: EditOriginalInteractionResponseInput): Promise<void> {
  const response = await fetchWithTimeout(
    `${DISCORD_API_BASE}/webhooks/${input.applicationId}/${input.interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: input.content,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to edit original interaction response (${response.status}): ${body}`);
  }
}
