import { Device } from 'mediasoup-client';
import { Socket } from 'socket.io-client';

interface MediasoupClientOptions {
  socket: Socket;
  roomId: string;
  peerId: string;
}

export class MediasoupClient {
  private device: Device;
  private socket: Socket;
  private roomId: string;
  private peerId: string;
  private sendTransport: any;
  private recvTransport: any;
  private producer: any;
  private consumers: Map<string, any>;
  private isConnected: boolean;
  private isProducing: boolean;
  private isRecording: boolean;
  private audioContext: AudioContext | null = null;
  private audioAnalyser: AnalyserNode | null = null;
  private audioSource: MediaStreamAudioSourceNode | null = null;
  private audioLevelInterval: any = null;
  private speakingThreshold: number = -50; // dB threshold to detect speaking

  constructor(options: MediasoupClientOptions) {
    this.device = new Device();
    this.socket = options.socket;
    this.roomId = options.roomId;
    this.peerId = options.peerId;
    this.consumers = new Map();
    this.isConnected = false;
    this.isProducing = false;
    this.isRecording = false;

    this.setupSocketListeners();
  }

  private setupSocketListeners() {
    this.socket.on('newProducer', async ({ peerId, producerId, kind }) => {
      if (peerId !== this.peerId && kind === 'audio') {
        await this.consume(producerId);
      }
    });

    this.socket.on('peerDisconnected', ({ peerId }) => {
      // Remove consumers for disconnected peer
      for (const [consumerId, consumer] of this.consumers.entries()) {
        if (consumer.appData.peerId === peerId) {
          consumer.close();
          this.consumers.delete(consumerId);
        }
      }
    });
  }

  public async connect() {
    try {
      console.log('Connecting to MediaSoup server...');
      
      // Get router RTP capabilities
      const rtpCapabilities = await this.loadRouterRtpCapabilities();
      console.log('Got router RTP capabilities', rtpCapabilities);
      
      // Load the device with router RTP capabilities
      await this.device.load({ routerRtpCapabilities: rtpCapabilities });
      console.log('Device loaded with RTP capabilities');
      
      // Create send transport
      this.sendTransport = await this.createTransport('send');
      console.log('Send transport created:', this.sendTransport.id);
      
      // Create receive transport
      this.recvTransport = await this.createTransport('recv');
      console.log('Receive transport created:', this.recvTransport.id);
      
      this.isConnected = true;
      console.log('MediaSoup connection established');
      
      return true;
    } catch (error) {
      console.error('Error connecting to MediaSoup:', error);
      return false;
    }
  }

  private async loadRouterRtpCapabilities(): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log('Getting router RTP capabilities...');
      
      const timeoutDuration = 20000; // 20 seconds timeout
      
      const timeout = setTimeout(() => {
        console.error('Timeout waiting for router capabilities');
        reject(new Error('Timeout getting router capabilities - server did not respond in time'));
      }, timeoutDuration);
      
      // Make multiple attempts
      const maxAttempts = 3;
      let attempts = 0;
      
      const attemptGetCapabilities = () => {
        attempts++;
        console.log(`Attempt ${attempts} to get router capabilities`);
        
        this.socket.emit('getRouterRtpCapabilities', {}, (response: any) => {
          if (response) {
            clearTimeout(timeout);
            
            if (response.error) {
              console.error('Error getting router capabilities:', response.error);
              
              if (attempts < maxAttempts) {
                console.log(`Retrying (${attempts}/${maxAttempts})...`);
                setTimeout(attemptGetCapabilities, 1000); // Wait 1 second before retry
              } else {
                reject(new Error(response.error));
              }
            } else {
              console.log('Got router capabilities successfully');
              resolve(response);
            }
          } else {
            // No response received
            if (attempts < maxAttempts) {
              console.log(`No response, retrying (${attempts}/${maxAttempts})...`);
              setTimeout(attemptGetCapabilities, 1000);
            } else {
              clearTimeout(timeout);
              reject(new Error('Failed to get router capabilities after multiple attempts'));
            }
          }
        });
      };
      
      attemptGetCapabilities();
    });
  }

  private async createTransport(direction: 'send' | 'recv') {
    const sender = direction === 'send';
    console.log(`Creating ${direction} transport...`);
    
    return new Promise((resolve, reject) => {
      this.socket.emit('createWebRtcTransport', { sender }, async (response: any) => {
        if (response.error) {
          console.error(`Error creating ${direction} transport:`, response.error);
          reject(new Error(response.error));
          return;
        }
        
        const { transportId, params } = response;
        console.log(`Got ${direction} transport parameters, ID: ${transportId}`);
        
        // Create the local transport
        const transport = sender
          ? this.device.createSendTransport({
              id: transportId,
              iceParameters: params.iceParameters,
              iceCandidates: params.iceCandidates,
              dtlsParameters: params.dtlsParameters,
            })
          : this.device.createRecvTransport({
              id: transportId,
              iceParameters: params.iceParameters,
              iceCandidates: params.iceCandidates,
              dtlsParameters: params.dtlsParameters,
            });
        
        // Set up transport events
        transport.on('connect', ({ dtlsParameters }, callback, errback) => {
          console.log(`Transport connect event, ${direction} transport:`, transportId);
          this.socket.emit(
            'connectWebRtcTransport',
            {
              transportId,
              dtlsParameters,
            },
            (response: any) => {
              if (response.error) {
                console.error(`Error connecting ${direction} transport:`, response.error);
                errback(new Error(response.error));
              } else {
                console.log(`${direction} transport connected successfully`);
                callback();
              }
            }
          );
        });
        
        if (sender) {
          transport.on('produce', (parameters, callback, errback) => {
            console.log('Transport produce event, parameters:', parameters.kind);
            this.socket.emit(
              'produce',
              {
                transportId,
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              },
              (response: any) => {
                if (response.error) {
                  console.error('Error producing:', response.error);
                  errback(new Error(response.error));
                } else {
                  console.log('Producer ID received from server:', response.id);
                  callback({ id: response.id });
                }
              }
            );
          });
        }
        
        resolve(transport);
      });
    });
  }

  public async produce() {
    try {
      if (!this.sendTransport || !this.isConnected) {
        throw new Error('Not connected to MediaSoup');
      }
      
      console.log('Requesting microphone access...');
      
      // Get the audio track
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log('Microphone access granted');
      
      const track = stream.getAudioTracks()[0];
      
      if (!track) {
        throw new Error('No audio track found in user media');
      }
      
      console.log('Creating audio producer with track:', track.label);
      
      // Create producer
      this.producer = await this.sendTransport.produce({
        track,
        codecOptions: {
          opusStereo: true,
          opusDtx: true,
        },
        appData: { peerId: this.peerId },
      });
      
      console.log('Audio producer created:', this.producer.id);
      
      this.isProducing = true;
      this.isRecording = true;
      
      // Set up audio level detection
      this.setupAudioLevelDetection(stream);
      
      // Handle producer events
      this.producer.on('transportclose', () => {
        console.log('Producer transport closed');
        this.stopAudioLevelDetection();
        this.producer = null;
        this.isProducing = false;
        this.isRecording = false;
      });
      
      return true;
    } catch (error) {
      console.error('Error producing audio:', error);
      return false;
    }
  }

  private setupAudioLevelDetection(stream: MediaStream) {
    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.audioSource = this.audioContext.createMediaStreamSource(stream);
      this.audioAnalyser = this.audioContext.createAnalyser();
      
      this.audioAnalyser.minDecibels = -90;
      this.audioAnalyser.maxDecibels = -10;
      this.audioAnalyser.smoothingTimeConstant = 0.85;
      this.audioAnalyser.fftSize = 256;
      
      this.audioSource.connect(this.audioAnalyser);
      
      const dataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
      let speaking = false;
      
      // Check audio levels at intervals
      this.audioLevelInterval = setInterval(() => {
        if (!this.audioAnalyser) return;
        
        this.audioAnalyser.getByteFrequencyData(dataArray);
        
        // Calculate volume level
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        
        const average = sum / dataArray.length;
        // Convert to decibels (rough approximation)
        const decibels = average === 0 ? -90 : 20 * Math.log10(average / 255);
        
        // Detect speaking state changes
        const isSpeaking = decibels > this.speakingThreshold;
        
        if (isSpeaking !== speaking) {
          speaking = isSpeaking;
          
          // Emit speaking status to server
          this.socket.emit('speaking', {
            roomId: this.roomId,
            peerId: this.peerId,
            speaking
          });
        }
      }, 100); // Check every 100ms
    } catch (error) {
      console.error('Error setting up audio level detection:', error);
    }
  }

  private stopAudioLevelDetection() {
    if (this.audioLevelInterval) {
      clearInterval(this.audioLevelInterval);
      this.audioLevelInterval = null;
    }
    
    if (this.audioSource) {
      this.audioSource.disconnect();
      this.audioSource = null;
    }
    
    if (this.audioAnalyser) {
      this.audioAnalyser = null;
    }
    
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch((err: Error) => {
        console.error('Error closing audio context:', err);
      });
      this.audioContext = null;
    }
  }

  public async consume(producerId: string) {
    try {
      if (!this.recvTransport || !this.isConnected) {
        throw new Error('Not connected to MediaSoup');
      }
      
      console.log('Attempting to consume producer:', producerId);
      
      // Get producer info
      const rtpCapabilities = this.device.rtpCapabilities;
      
      return new Promise((resolve, reject) => {
        this.socket.emit(
          'consume',
          {
            producerId,
            rtpCapabilities,
            transportId: this.recvTransport.id,
          },
          async (response: any) => {
            if (response.error) {
              console.error('Error from server when consuming:', response.error);
              reject(new Error(response.error));
              return;
            }
            
            const { id, producerId, kind, rtpParameters } = response;
            console.log(`Got consume response for ${kind} track, ID: ${id}`);
            
            try {
              // Create consumer
              const consumer = await this.recvTransport.consume({
                id,
                producerId,
                kind,
                rtpParameters,
                appData: { peerId: this.peerId },
              });
              
              console.log('Consumer created successfully', consumer.id);
              
              // Store consumer
              this.consumers.set(consumer.id, consumer);
              
              // Create audio element and play the audio
              if (kind === 'audio') {
                const audioTrack = consumer.track;
                if (audioTrack) {
                  console.log('Creating audio element for consumer', consumer.id);
                  const stream = new MediaStream([audioTrack]);
                  const audioElement = document.createElement('audio');
                  audioElement.id = `audio-${consumer.id}`;
                  audioElement.srcObject = stream;
                  audioElement.autoplay = true;
                  audioElement.volume = 1.0; // Maximum volume
                  
                  // Important: Add these attributes for better audio playback
                  audioElement.setAttribute('playsinline', '');
                  audioElement.muted = false; 
                  
                  // Add to DOM to ensure it plays
                  document.body.appendChild(audioElement);
                  
                  // Attempt to play immediately
                  const playPromise = audioElement.play();
                  
                  if (playPromise !== undefined) {
                    playPromise.then(() => {
                      console.log(`[Client ${this.peerId}] Audio playback initiated successfully for consumer ${consumer.id}`);
                      // Explicitly ensure unmuted state *after* successful play starts
                      audioElement.muted = false;
                    }).catch(error => {
                      console.error('Audio playback failed:', error);
                      
                      // Create event handler for user interaction to enable audio
                      const userInteractionHandler = () => {
                        console.log('User interaction detected, trying to play audio again');
                        audioElement.play()
                          .then(() => {
                            console.log('Audio playing successfully after user interaction');
                            document.removeEventListener('click', userInteractionHandler);
                            document.removeEventListener('touchstart', userInteractionHandler);
                          })
                          .catch(e => console.error('Still cannot play audio after user interaction:', e));
                      };
                      
                      // Add event listeners for user interaction
                      document.addEventListener('click', userInteractionHandler);
                      document.addEventListener('touchstart', userInteractionHandler);
                    });
                  }
                  
                  // Store the audio element with the consumer for cleanup
                  consumer.appData.audioElement = audioElement;
                }
              }
              
              // Resume the consumer
              this.socket.emit('resumeConsumer', { consumerId: consumer.id }, (response: any) => {
                if (response.error) {
                  console.error('Error resuming consumer:', response.error);
                } else {
                  console.log('Consumer resumed successfully');
                }
              });
              
              // Handle consumer events
              consumer.on('transportclose', () => {
                console.log('Consumer transport closed', consumer.id);
                this.consumers.delete(consumer.id);
                
                // Clean up audio resources
                this.cleanupAudioResources(consumer.appData);
              });
              
              resolve(consumer);
            } catch (err) {
              console.error('Error creating consumer:', err);
              reject(err);
            }
          }
        );
      });
    } catch (error) {
      console.error('Error consuming audio:', error);
      return null;
    }
  }

  public stopProducing() {
    if (this.producer) {
      this.socket.emit('stopRecording', { producerId: this.producer.id }, (response: any) => {
        if (response.error) {
          console.error('Error stopping recording:', response.error);
        }
      });
      
      this.stopAudioLevelDetection();
      
      // Notify server that we stopped speaking
      this.socket.emit('speaking', {
        roomId: this.roomId,
        peerId: this.peerId,
        speaking: false
      });
      
      this.producer.close();
      this.producer = null;
      this.isProducing = false;
      this.isRecording = false;
    }
  }

  public disconnect() {
    this.stopProducing();
    
    // Close all consumers and clean up audio resources
    for (const [, consumer] of this.consumers) {
      this.cleanupAudioResources(consumer.appData);
      consumer.close();
    }
    this.consumers.clear();
    
    // Close transports
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }
    
    if (this.recvTransport) {
      this.recvTransport.close();
      this.recvTransport = null;
    }
    
    this.isConnected = false;
  }

  public isReadyToProduceOrConsume() {
    return this.device?.loaded && this.isConnected;
  }

  public getProducerState() {
    return {
      isProducing: this.isProducing,
      isRecording: this.isRecording,
    };
  }

  public getConsumerCount() {
    return this.consumers.size;
  }

  private cleanupAudioResources(appData: any) {
    // Clean up audio element
    if (appData.audioElement) {
      console.log('Cleaning up audio element', appData.audioElement.id);
      
      try {
        // Stop the audio
        appData.audioElement.pause();
        appData.audioElement.srcObject = null;
        
        // Remove from DOM
        if (appData.audioElement.parentNode) {
          appData.audioElement.parentNode.removeChild(appData.audioElement);
        } else if (document.body.contains(appData.audioElement)) {
          document.body.removeChild(appData.audioElement);
        }
      } catch (err) {
        console.error('Error cleaning up audio element:', err);
      }
    }
    
    // Clean up Web Audio API resources
    if (appData.sourceNode) {
      appData.sourceNode.disconnect();
    }
    
    if (appData.gainNode) {
      appData.gainNode.disconnect();
    }
    
    if (appData.audioCtx && appData.audioCtx.state !== 'closed') {
      appData.audioCtx.close().catch((err: Error) => {
        console.error('Error closing audio context:', err);
      });
    }
  }
} 