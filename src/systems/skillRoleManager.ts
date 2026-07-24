import { Client, Guild } from 'discord.js';
import prisma from '../lib/prisma';
import { config } from '../config';
import { markInternalAntiRaidAction } from './antiRaidManager';

export type SkillKey = (typeof config.skills)[number]['key'];

const SKILL_KEYS = config.skills.map(s => s.key) as readonly string[];
const roleIdCache = new Map<string, string>(); // skillKey -> roleId

function managedKey(skillKey: string): string {
    return `skillrole:${skillKey}`;
}

export function isSkillKey(value: string | null | undefined): value is SkillKey {
    return !!value && SKILL_KEYS.includes(value);
}

export function getSkillMeta(skillKey: string) {
    return config.skills.find(s => s.key === skillKey) || null;
}

// Create any missing skill role on startup and persist its ID. config.ts is a
// static file, so IDs live in ManagedChannel (key "skillrole:<key>"), matching
// the existing managed-channel persistence pattern. There is NO reusable level-role
// bootstrap — updateLevelRole is lazy/level-up-triggered, so this is its own pass.
export async function ensureSkillRoles(guild: Guild): Promise<void> {
    let rows: { key: string; channelId: string }[] = [];
    try {
        rows = await prisma.managedChannel.findMany({
            where: { key: { in: config.skills.map(s => managedKey(s.key)) } }
        });
    } catch (error) {
        console.error('Skill-role bootstrap: failed to read persisted IDs:', error);
    }
    const persisted = new Map(rows.map(r => [r.key, r.channelId]));

    for (const skill of config.skills) {
        const savedId = persisted.get(managedKey(skill.key));
        // Reuse a persisted role if it still exists on the guild.
        if (savedId && guild.roles.cache.has(savedId)) {
            roleIdCache.set(skill.key, savedId);
            continue;
        }
        // Otherwise reuse a role with the same name if present.
        let role = guild.roles.cache.find(r => r.name === skill.roleName);
        if (!role) {
            try {
                markInternalAntiRaidAction('roleCreate', '*');
                role = await guild.roles.create({
                    name: skill.roleName,
                    color: skill.color,
                    mentionable: true,
                    reason: 'Stella Bot — skill role for request routing'
                });
            } catch (error) {
                console.error(`Skill-role bootstrap: failed to create ${skill.roleName}:`, error);
                continue;
            }
        }
        roleIdCache.set(skill.key, role.id);
        await prisma.managedChannel.upsert({
            where: { key: managedKey(skill.key) },
            update: { channelId: role.id },
            create: { key: managedKey(skill.key), channelId: role.id }
        }).catch(error => console.error(`Skill-role bootstrap: failed to persist ${skill.key}:`, error));
    }
}

// Resolve a skill key to its live role ID (cache first, then DB). Returns null if
// unresolved so callers can skip the ping instead of pinging a bad ID.
export async function resolveSkillRoleId(skillKey: string): Promise<string | null> {
    const cached = roleIdCache.get(skillKey);
    if (cached) return cached;
    const row = await prisma.managedChannel.findUnique({ where: { key: managedKey(skillKey) } }).catch(() => null);
    if (row?.channelId) {
        roleIdCache.set(skillKey, row.channelId);
        return row.channelId;
    }
    return null;
}

// Ping the matching skill role in the request channel exactly once, on create.
// Fail-safe: skip if the role ID is empty or equals the guild ID (guild ID =
// @everyone, which would mass-ping and trip anti-raid).
export async function pingSkillRole(
    client: Client,
    guildId: string | null,
    channelId: string,
    skillKey: string,
    requestId: number
): Promise<void> {
    if (!isSkillKey(skillKey)) return;
    const roleId = await resolveSkillRoleId(skillKey);
    if (!roleId || roleId === guildId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) return;

    const meta = getSkillMeta(skillKey);
    await channel.send({
        content: `<@&${roleId}> · yêu cầu mới #${requestId} cần **${meta?.label || skillKey}**`,
        allowedMentions: { roles: [roleId] }
    }).catch(() => {});
}

// Toggle a skill role on a member (self-serve). Returns the new state.
export async function toggleSkillRole(guild: Guild, memberId: string, skillKey: string): Promise<'added' | 'removed' | null> {
    if (!isSkillKey(skillKey)) return null;
    const roleId = await resolveSkillRoleId(skillKey);
    if (!roleId) return null;
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (!member) return null;

    if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
        return 'removed';
    }
    await member.roles.add(roleId).catch(() => {});
    return 'added';
}
