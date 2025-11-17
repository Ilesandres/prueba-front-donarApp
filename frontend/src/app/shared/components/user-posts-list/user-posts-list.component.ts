import { Component, Input, OnChanges, SimpleChanges, OnDestroy, HostListener, Pipe, PipeTransform } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Subject, takeUntil } from 'rxjs';
import { Post, PostsService } from '../../../core/services/posts.service';
import { AuthService } from '../../../core/services/auth.service';
import { ScrollRestorationService } from '../../../core/services/scroll-restoration.service';
import { AcknowledgmentFormComponent } from '../acknowledgment-form/acknowledgment-form.component';
import { AcknowledgmentListComponent } from '../acknowledgment-list/acknowledgment-list.component';

@Pipe({ name: 'safeUrl' })
export class SafeUrlPipe implements PipeTransform {
  constructor(private sanitizer: DomSanitizer) {}
  transform(url: string): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  }
}

@Component({
  selector: 'app-user-posts-list',
  standalone: true,
  imports: [CommonModule, RouterModule, SafeUrlPipe, AcknowledgmentFormComponent, AcknowledgmentListComponent],
  templateUrl: './user-posts-list.component.html',
  styleUrls: ['./user-posts-list.component.scss']
})
export class UserPostsListComponent implements OnChanges, OnDestroy {
  private destroy$ = new Subject<void>();
  
  @Input() posts: Post[] = [];
  @Input() isLoading: boolean = false;
  @Input() errorMessage: string = '';

  isAuthenticated = false;
  currentUserId: number | null = null;
  isOrganization = false;

  // Image gallery modal
  showImageModal = false;
  currentGalleryFiles: { url: string, type: 'image' | 'video' | 'audio' | 'pdf' | 'doc' }[] = [];
  currentGalleryIndex = 0;

  // Acknowledgments (comentarios) por post
  showComments: { [postId: number]: boolean } = {};

  constructor(
    private router: Router,
    private authService: AuthService,
    private postsService: PostsService,
    private scrollService: ScrollRestorationService
  ) {
    this.isAuthenticated = this.authService.isAuthenticated();
    const currentUser = this.authService.currentUserValue;
    this.currentUserId = currentUser?.id ? Number(currentUser.id) : null;
    this.isOrganization = currentUser?.role === 'organization';
  }

  toggleComments(postId: number): void {
    this.showComments[postId] = !this.showComments[postId];
  }

  isCommentsOpen(postId: number): boolean {
    return !!this.showComments[postId];
  }

  onAcknowledgmentCreated(postId: number): void {
    // Recargar agradecimientos cuando se crea uno nuevo
    // El componente AcknowledgmentListComponent maneja su propia recarga
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['posts']) {
      //console.log('Posts received:', this.posts);
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get canLike(): boolean {
    return this.authService.canLike();
  }

  get canRequestDonation(): boolean {
    return this.authService.canRequestDonation();
  }

  toggleLike(post: Post, event: Event): void {
    event.stopPropagation();
    
    if (!this.authService.canLike()) {
      this.router.navigate(['/auth/login']);
      return;
    }

    if (post.userHasLiked) {
      this.postsService.removeLikeFromPost(post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            post.userHasLiked = false;
            post.likesCount--;
          },
          error: (err) => console.error('Error removing like:', err)
        });
    } else {
      this.postsService.addLikeToPost(post.id)
        .pipe(takeUntil(this.destroy$))
        .subscribe({
          next: () => {
            post.userHasLiked = true;
            post.likesCount++;
          },
          error: (err) => console.error('Error adding like:', err)
        });
    }
  }

  viewPostDetails(postId: number): void {
    // Guardar posición de scroll para el perfil antes de navegar a detalles
    this.scrollService.savePosition('profileScrollPosition');
    this.router.navigate(['/post', postId]);
  }

  // Helpers para tipo de archivo
  isPdfFile(url: string): boolean {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.endsWith('.pdf') || u.includes('.pdf?') || u.startsWith('data:application/pdf');
  }

  isVideoFile(url: string): boolean {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.endsWith('.mp4') || u.endsWith('.webm') || u.endsWith('.ogg');
  }

  isAudioFile(url: string): boolean {
    if (!url) return false;
    const u = url.toLowerCase();
    return u.endsWith('.mp3') || u.endsWith('.wav') || u.endsWith('.ogg');
  }

  isImageFile(url: string): boolean {
    if (!url) return false;
    return /\.(jpeg|jpg|png|gif|bmp|webp)$/.test(url.toLowerCase());
  }

  openGallery(files: any[], index: number, event?: Event): void {
    if (event) event.stopPropagation();
    // files: post.imagePost
    this.currentGalleryFiles = files.map(f => {
      const url = f.image;
      if (this.isImageFile(url)) return { url, type: 'image' as const };
      if (this.isVideoFile(url)) return { url, type: 'video' as const };
      if (this.isAudioFile(url)) return { url, type: 'audio' as const };
      if (this.isPdfFile(url)) return { url, type: 'pdf' as const };
      return { url, type: 'doc' as const };
    });
    this.currentGalleryIndex = index;
    this.showImageModal = true;
    document.body.style.overflow = 'hidden';
  }

  openImageGallery(images: any[], event: Event): void {
    this.openGallery(images, 0, event);
  }

  closeImageGallery(): void {
    this.showImageModal = false;
    document.body.style.overflow = 'auto';
  }

  nextGalleryFile(): void {
    if (this.currentGalleryIndex < this.currentGalleryFiles.length - 1) {
      this.currentGalleryIndex++;
    }
  }

  previousGalleryFile(): void {
    if (this.currentGalleryIndex > 0) {
      this.currentGalleryIndex--;
    }
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if (!this.showImageModal) return;
    if (event.key === 'ArrowRight') {
      this.nextGalleryFile();
    } else if (event.key === 'ArrowLeft') {
      this.previousGalleryFile();
    } else if (event.key === 'Escape') {
      this.closeImageGallery();
    }
  }

  requestDonation(post: Post, event: Event): void {
    event.stopPropagation();
    
    if (!this.authService.canRequestDonation()) {
      if (!this.authService.isAuthenticated()) {
        this.router.navigate(['/auth/login']);
      } else {
        // Mostrar mensaje de que necesita verificación
        alert('Debes verificar tu cuenta para solicitar donaciones');
      }
      return;
    }
    
    this.router.navigate(['/organization/donations/create'], {
      queryParams: { post: post.id }
    });
  }

  donateToCampaign(post: Post, event: Event): void {
    event.stopPropagation();
    this.router.navigate(['/donor/donate'], {
      queryParams: { campaign: post.id }
    });
  }

  isPostOwner(post: Post): boolean {
    if (!post || !this.currentUserId) return false;
    return post.user.id === this.currentUserId;
  }

  getTypeColor(typeName: string): string {
    const typeColors: { [key: string]: string } = {
      'donacion': 'bg-blue-100 text-blue-800',
      'publicacion': 'bg-purple-100 text-purple-800',
      'donacion completada': 'bg-green-100 text-green-800',
      'solicitud de donacion': 'bg-orange-100 text-orange-800',
      'articulos para donar': 'bg-pink-100 text-pink-800'
    };
    return typeColors[typeName.toLowerCase()] || 'bg-gray-100 text-gray-800';
  }
}
