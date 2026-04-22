import { useState } from 'react'
import { useAuthContext } from '@/context/AuthContext'
import { api } from '@/lib/api'
import type { ProfileFormData } from '@/schemas/profileSchemas'

export function useProfile() {
    const { user, updateUser } = useAuthContext()
    const [isLoading, setIsLoading] = useState(false)
    const [error,     setError]     = useState<string | null>(null)
    const [success,   setSuccess]   = useState(false)

    const updateProfile = async (data: ProfileFormData) => {
        try {
            setIsLoading(true)
            setError(null)
            setSuccess(false)

            const res = await api.profile.update({
                username: data.username,
                bio: data.bio ?? '',
            })
            if (user) {
                updateUser(res.data) 
            }
            setSuccess(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to update profile')
        } finally {
            setIsLoading(false)
        }
    }

    const uploadAvatar = async (file: File) => {
        try {
            setIsLoading(true)
            setError(null)

            const res = await api.profile.uploadAvatar(file)
            if (user) {
                updateUser({           
                    ...user,
                    avatarUrl: res.data.avatarUrl,
                })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to upload avatar')
        } finally {
            setIsLoading(false)
        }
    }

    return { updateProfile, uploadAvatar, isLoading, error, success }
}