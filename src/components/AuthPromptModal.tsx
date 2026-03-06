import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Modal, ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Keyboard } from 'react-native';
import { Mail, X, CheckCircle } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';

export type AuthPromptModalProps = {
    visible: boolean;
    onClose: () => void;
    title?: string;
    subtitle?: string;
    /**
     * If provided, changes the CTA copy, e.g. "Save & Send Link"
     */
    ctaText?: string;
};

export default function AuthPromptModal({
    visible,
    onClose,
    title = 'Sync your data',
    subtitle = 'Sign in to keep your routes synced across devices and back up your data.',
    ctaText = 'Send Magic Link',
}: AuthPromptModalProps) {
    const { requestMagicLink } = useAuth();
    const [email, setEmail] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const handleSendLink = async () => {
        const trimmed = email.trim();
        if (!trimmed || !trimmed.includes('@')) {
            setErrorMsg('Please enter a valid email address.');
            return;
        }
        setErrorMsg('');
        setLoading(true);

        try {
            const result = await requestMagicLink(trimmed);
            if (result.success) {
                setSuccess(true);
            } else {
                setErrorMsg(result.error || 'Failed to send link. Please try again.');
            }
        } catch {
            setErrorMsg('Network error. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const resetAndClose = () => {
        onClose();
        // Small delay so the modal closes smoothly before resetting state
        setTimeout(() => {
            setEmail('');
            setSuccess(false);
            setErrorMsg('');
            setLoading(false);
        }, 300);
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={resetAndClose}
        >
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <Pressable style={styles.overlayTapTarget} onPress={Keyboard.dismiss} />
                <View style={styles.card}>
                    <TouchableOpacity style={styles.closeButton} onPress={resetAndClose} hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                        <X size={24} color="#64748B" />
                    </TouchableOpacity>

                    {success ? (
                        <View style={styles.successContent}>
                            <View style={styles.iconCircleSuccess}>
                                <CheckCircle size={32} color="#107C10" />
                            </View>
                            <Text style={styles.title}>Check your inbox!</Text>
                            <Text style={styles.subtitle}>
                                We sent a secure link to <Text style={styles.emailHighlight}>{email}</Text>. Tap it to instantly sign in.
                            </Text>
                            <TouchableOpacity style={styles.button} onPress={resetAndClose} activeOpacity={0.8}>
                                <Text style={styles.buttonText}>Got it</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.formContent}>
                            <View style={styles.iconCircle}>
                                <Mail size={28} color="#0078D4" />
                            </View>
                            <Text style={styles.title}>{title}</Text>
                            <Text style={styles.subtitle}>{subtitle}</Text>

                            <View style={styles.inputWrap}>
                                <TextInput
                                    style={styles.input}
                                    placeholder="Enter your email"
                                    placeholderTextColor="#94A3B8"
                                    keyboardType="email-address"
                                    textContentType="emailAddress"
                                    autoComplete="email"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    value={email}
                                    onChangeText={(val) => {
                                        setEmail(val);
                                        setErrorMsg('');
                                    }}
                                    editable={!loading}
                                    returnKeyType="send"
                                    blurOnSubmit
                                    onSubmitEditing={() => {
                                        if (!loading) {
                                            void handleSendLink();
                                        }
                                    }}
                                />
                            </View>

                            {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

                            <TouchableOpacity
                                style={[styles.button, loading && styles.buttonDisabled]}
                                onPress={handleSendLink}
                                disabled={loading}
                                activeOpacity={0.8}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={styles.buttonText}>{ctaText}</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    overlayTapTarget: {
        ...StyleSheet.absoluteFillObject,
    },
    card: {
        position: 'relative',
        zIndex: 1,
        backgroundColor: '#fff',
        borderRadius: 20,
        width: '100%',
        maxWidth: 400,
        padding: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 8,
    },
    closeButton: {
        position: 'absolute',
        top: 16,
        right: 16,
        zIndex: 10,
    },
    formContent: {
        alignItems: 'center',
        marginTop: 8,
    },
    successContent: {
        alignItems: 'center',
        marginTop: 8,
    },
    iconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#EFF6FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    iconCircleSuccess: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#F0FDF4',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    title: {
        fontSize: 22,
        fontWeight: '800',
        color: '#0F172A',
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 15,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 24,
    },
    emailHighlight: {
        fontWeight: '700',
        color: '#0F172A',
    },
    inputWrap: {
        width: '100%',
        marginBottom: 16,
    },
    input: {
        width: '100%',
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        fontSize: 16,
        color: '#0F172A',
    },
    errorText: {
        color: '#DC2626',
        fontSize: 13,
        marginBottom: 16,
        textAlign: 'center',
    },
    button: {
        width: '100%',
        backgroundColor: '#0078D4',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
    },
    buttonDisabled: {
        opacity: 0.7,
    },
    buttonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '700',
    },
});
