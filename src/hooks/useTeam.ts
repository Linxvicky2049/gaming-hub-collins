import { useState, useEffect } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import { api } from '@/lib/api'
import type { TeamDetail, CreateTeamPayload } from '@/types'

export function useTeam() {
    const { user } = useAuthContext()
    const [team,      setTeam]      = useState<TeamDetail | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error,     setError]     = useState<string | null>(null)
    const [success,   setSuccess]   = useState<string | null>(null)

    // Fetch user's team on mount
    useEffect(() => {
        const fetchTeam = async () => {
            try {
                setIsLoading(true)
                const res = await api.teams.getMyTeam()
                setTeam(res.data)
            } catch {
                setTeam(null)  // null means user has no team yet
            } finally {
                setIsLoading(false)
            }
        }
        fetchTeam()
    }, [user])

    const createTeam = async (payload: CreateTeamPayload) => {
        try {
            setIsLoading(true)
            setError(null)
            setSuccess(null)

            const res = await api.teams.create(payload)
            setTeam(res.data)
            setSuccess('Team created successfully!')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create team')
        } finally {
            setIsLoading(false)
        }
    }

    const joinTeam = async (teamId: string) => {
        try {
            setIsLoading(true)
            setError(null)
            setSuccess(null)

            await api.teams.join(teamId)
            const res = await api.teams.get(teamId)
            setTeam(res.data)
            setSuccess('Successfully joined the team!')
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to join team')
        } finally {
            setIsLoading(false)
        }
    }

    const leaveTeam = async () => {
        if (!team) return
        try {
            setIsLoading(true)
            setError(null)

            await api.teams.leave(team.id)
            setTeam(null)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to leave team')
        } finally {
            setIsLoading(false)
        }
    }

    return {
        team,
        isLoading,
        error,
        success,
        createTeam,
        joinTeam,
        leaveTeam,
    }
}
